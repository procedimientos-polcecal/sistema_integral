# Despacho — Órdenes de carga

Primer spec del módulo **Despacho**, el séptimo del SdG. Registra el camión
mientras está en el predio, en vez de transcribirlo a la mañana siguiente.

## Qué reemplaza

El talonario en papel **ORDEN DE CARGA** (formulario `086/2`), con su número
preimpreso arriba a la derecha —`13801` en el que se relevó—, y la planilla de
Google `Órdenes de Carga`
(`1jF2lqDn_9H_BRQ8TQFNopfappOPyMGCQwFsGkWSkonM`), que hoy se llena **a la mañana
siguiente con todas las órdenes del día anterior**.

El papel tiene dos mitades y dos dueños:

| Mitad | Quién la llena | Campos |
|---|---|---|
| Qué se lleva | Administración, al emitir el remito | Fecha, Cliente, Material, Granulometría, Envase |
| Cuándo pasó | El encargado de balanza, con el camión ahí | Entrada Predio, Inicio de carga, Fin de carga, Salida Predio, Notas, firma del supervisor |

La planilla tiene once columnas: `Fecha Orden`, `Nro de Orden`, `Cliente`,
`Material`, `Hora comienzo de Carga`, `Hora Salida de carga`, `Hora Ingreso al
predio`, `Hora Salida del Predio`, `Observaciones`, `Tiempo de Carga`, `Tiempo
en Predio`.

Tres cosas de esa comparación deciden el diseño:

1. **La columna `Material` de la planilla son tres campos del papel aplastados
   en una celda** (material, granulometría y envase).
2. **`Tiempo de Carga` y `Tiempo en Predio` son restas de las otras columnas**,
   no datos.
3. **No hay cantidad, ni patente, ni transportista, ni chofer.** La cantidad
   vive en el remito de Odoo; los otros tres no viven en ninguna parte.

## La cadena real del dato

Ventas pasa el pedido → se carga en Odoo → **de Odoo sale el remito** → el
remito viaja junto con la orden de carga del talonario → al otro día la orden se
tipea en la planilla.

O sea que cliente, producto y cantidad **ya existen en un sistema**. Lo único
que no existe en ningún sistema es el vínculo entre el Nº del talonario y ese
remito, y los cuatro horarios.

## Lo que se relevó de Odoo (08/09/2026)

Contra la base real, con las credenciales de `.env.local` y las dos empresas en
`allowed_company_ids`:

| | |
|---|---|
| `sale.order` | 8.516 (Polysan 4.760, Polcecal 3.756) |
| `stock.picking` | 12.354 |
| Remitos de salida (`picking_type_code = outgoing`) | **10.027** (Polysan 5.771, Polcecal 4.256) |
| Remitos de salida por día | **20 a 28**, con picos de 37 y 49 |
| `product.template` | 432 |

Y cinco hallazgos que cambiaron el diseño:

**El Nº de la orden de carga no tiene dónde vivir en Odoo.** `stock.picking`
tiene 121 campos y un único campo propio agregado con Studio
(`x_studio_related_field_1r2_1j1blu3vo`, un many2one de otra cosa). No hay dónde
guardarlo, y no se puede agregar: la instancia es de un partner y no admite
módulos propios. **Por eso la orden de carga es una tabla del SdG.**

**Los tres campos del talonario están metidos dentro del nombre del producto.**
`CARBONATO DE CALCIO 0-1 BOLSÓN (NA)` es material + granulometría + envase en
una cadena, con espacios al final y sufijos `(NA)` / `(EA)`. Pero los productos
tienen **código interno** —`[FAG]`, `[CET]`, `[CC02B]`, `[P620]`—, que sí es un
identificador.

**El talonario está desactualizado respecto de lo que sale.** Sus cuatro
materiales (Calcio, Magnesio, Filler, Cal) no alcanzan: en los últimos 90 días
se despachó `Chocolata`, `Pedregullo 6/20`, `Minerales Ecológicos` y `Aditivo
Calcáreo`. Y hay un envase que el papel no tiene: **Tolva** (`CAL EN TOLVA`,
`FILLER CALCAREO (TOLVA)`). Un módulo que clave las opciones del papel no puede
registrar la mitad de los camiones.

**El transportista no existe: `carrier_id` está vacío en 1.422 de 1.422
remitos.** Medir por transportista requiere empezar a capturar el dato. No está
en este spec.

**Las dos empresas numeran y trabajan distinto.** Polcecal emite
`0001-00077045` (numeración fiscal) y valida casi todo (552 `done`, 1 `draft` en
90 días). Polysan emite `Polys/OUT/05776` y deja colgado: 19 `confirmed` y 20
`draft`. **La pantalla no puede asumir que el remito ya está validado.**

## Quién manda

**Manda el sistema, y la planilla es un espejo de una sola vía.** Es la
dirección contraria a Compras e Inventario, y la misma que Producción: la
planilla queda como el lugar donde miran los que no entran al sistema.

Del lado de Odoo se aplica la regla de `docs/ODOO-INTEGRACION.md` sin excepción:
**el SdG propone, Odoo confirma.** Acá el SdG sólo **lee** remitos y productos.
No crea, no valida, no toca un `stock.picking`.

## Alcance

Sólo las órdenes de carga. De los cinco frentes que tiene el área —recepción de
material, carga de camiones, programación del día, stock de producto terminado y
pedidos de clientes— este spec cubre uno.

### Lo que queda afuera a propósito

- **Recepción de material, programación del día, stock de producto terminado y
  pedidos de clientes.** Specs propios.
- **El catálogo de `clientes` en el núcleo.** Producción lo está esperando
  (`produccion_despachos.cliente_raw` dice literalmente *"va a ser del módulo
  Despacho"*), y traerlo bien es su propio trabajo: más de 3.000 `res.partner`
  en dos empresas, y el cruce va **por CUIT (`vat`), no por nombre** — la
  lección de los 147 CUITs duplicados. Acá el cliente sale del remito, y
  `cliente_raw` cuando no hay remito.
- **El transportista y la patente.** No existen en ningún sistema.
- **El pesaje.** El puesto es la balanza, pero el peso no está en el papel, ni
  en la planilla, ni en el remito más allá de la cantidad pedida. Si el camión
  se pesa y ese número queda en algún lado, es un dato que el módulo debería
  capturar y hoy no está relevado.
- **Cruzar con `produccion_despachos`.** Ver abajo: es un spec futuro con valor
  propio.

## La frontera con Producción

Producción se construyó el 07 y 08/09/2026 y ya tiene `produccion_despachos`:
los renglones de camión del parte de turno. Su documento lo define sin
ambigüedad —*"lo que el capataz dice que cargó, el registro de fábrica, no el
remito ni el pesaje"*.

**El mismo camión va a estar registrado dos veces, y eso no es duplicación.**
Fábrica cuenta bultos por turno; despacho registra el remito y los tiempos por
camión. Son dos mediciones independientes del mismo hecho, con grano distinto
(turno contra camión), y cruzarlas es lo que va a mostrar los desajustes. Ese
cruce es un spec futuro, no éste.

Producción también dejó **el granel afuera a propósito**, con el catálogo
modelado *"como para sumarlo después"*. Despacho es por donde entra: `FILLER A
GRANEL` y `CAL EN TOLVA` están entre los más despachados y un remito son 36
toneladas.

## Datos

### `despacho_ordenes_carga`

Una fila por papel del talonario.

- `numero` — el Nº preimpreso, **`unique`**. Confirmado con el usuario: es único
  y no se repite entre talonarios.
- `fecha` — la fecha de la orden (`Fecha Orden`).
- `empresa_id` → `empresas`. Las dos numeran distinto y la orden tiene que decir
  de cuál es.
- `odoo_picking_id`, `odoo_picking_name`, `odoo_sale_name` — el remito y el
  pedido de origen (el `origin`, `S08526`). **Los tres nullables**: si Polysan
  dejó el remito en draft, la orden se guarda sin enlace.
- `cliente_raw`, `producto_raw` — lo que se escribió cuando no hay remito, o el
  nombre cacheado del que sí lo tiene.
- `odoo_product_id` — nullable, el producto del remito.
- `entrada_predio`, `inicio_carga`, `fin_carga`, `salida_predio` —
  `timestamptz`, los cuatro nullables.
- `notas` — el campo `Notas` del papel, que en la planilla es `Observaciones`.
- `supervisor_raw` + `supervisor_id` → `empleados` `on delete set null`. La
  firma del papel. El enlace **sólo cuando se lo reconoce con certeza**; y `set
  null` y no `restrict` porque la orden es un documento histórico y perder quién
  firmó es preferible a impedir dar de baja a un empleado que ya no está.
- `cargado_por`, `cargado_en`, `actualizado_por`, `actualizado_en`.
- `sheets_fila`, `sheets_pendiente`, `sheets_pendiente_en`.

**El estado y los tiempos no se guardan: se despejan al leer.** Es la misma
decisión que Producción tomó con la producción misma —*"guardarlo es exactamente
el error del Excel que este módulo reemplaza"*— y por el mismo motivo: un valor
derivado guardado se desincroniza y nada avisa. `Tiempo de Carga` es
`fin_carga − inicio_carga` y no una columna.

`sheets_fila` lleva **índice único común, no parcial**: un índice parcial no
sirve como destino de `ON CONFLICT` (trampa nº2 del README, que ya mordió en la
`033` y otra vez en la `046`), y en Postgres los nulos no chocan entre sí.

### `despacho_productos`

El mapeo que evita adivinar.

- `odoo_product_id` — `unique`.
- `odoo_default_code`, `odoo_nombre` — cacheados, el nombre con el espacio final
  recortado.
- `material`, `granulometria`, `envase` — **columnas de texto**, con la lista
  chica en `lib/despacho/clasificacion.ts`. `granulometria` nullable: hay
  productos que no la tienen.
- `produccion_producto_id` → `produccion_productos`, nullable. El puente con el
  catálogo de fábrica cuando el producto existe en los dos lados.
- `activo`.

Lo carga una persona desde una pantalla de administración. **Lo que no está
mapeado se muestra "sin clasificar" y se ve que falta.**

Dos decisiones explícitas:

**No se reusan los enums de Producción.** `produccion_familia` es
`filler / 0_2 / cal / otros`, y `0_2` mezcla material con granulometría: no es
una familia, es un tamaño. `produccion_envase` es sólo `bolsa / bolson`. Forzar
el mapeo ahí perdería el granel, la tolva y la granulometría entera.

**Y no son enums nuevos tampoco.** Un enum de Postgres obliga a una migración
sola por cada valor nuevo (`55P04`, la trampa que ya mordió dos veces), y estos
valores van a crecer a medida que se mapeen los 432 productos. Texto con la
lista en el código, y la pantalla ofrece la lista.

**No se parsea el nombre del producto.** `CARBONATO DE CALCIO 0-1 BOLSÓN (NA)`
con expresiones regulares es la forma segura de que un día `CAL EN TOLVA` entre
como envase `Bolsa` y nadie lo note. Enlazar al que se le parece es peor que
dejar en null.

## Pantallas y flujo

`page.tsx` de servidor que trae y calcula, `XClient.tsx` que sólo muestra, la
aritmética en `lib/despacho/` con tests. El patrón del repo.

### `/despacho` — la cola del día

La pantalla que va a estar abierta todo el día en la PC de la balanza (hay PC
con internet en el puesto: el registro en vivo es viable y no hace falta modo
sin conexión).

Una fila por orden. **El estado se despeja de los cuatro horarios:**

| Estado | Cuándo |
|---|---|
| Esperando | remito emitido, sin `entrada_predio` |
| En predio | entró, sin `inicio_carga` |
| Cargando | `inicio_carga` sin `fin_carga` |
| Cargado | `fin_carga` sin `salida_predio` |
| Cerrada | tiene los cuatro |

Cada fila muestra Nº de orden, cliente, producto (material · granulometría ·
envase), las toneladas del remito, y **el reloj corriendo del tramo en curso**
—*"cargando hace 42 min"*—, que es lo que la planilla del día siguiente no puede
dar.

**Un solo botón por fila: el del próximo horario que falta.** No cuatro. El
encargado no elige qué marcar, marca lo que acaba de pasar en el camión que
tiene delante; cuatro botones son cuatro oportunidades de marcar el equivocado
con un camión esperando. Cada botón guarda **la hora del servidor**, no una hora
tipeada.

### Dar de alta una orden

1. El **Nº del talonario** primero, porque es lo que tiene en la mano.
2. Elige de la lista de **remitos de salida del día que todavía no tienen orden
   de carga**, traídos de Odoo. Con eso vienen cliente, producto, toneladas y
   empresa sin tipear nada.
3. Si el remito no está —Polysan deja 20 en draft cada 90 días— hay un camino
   explícito de **"sin remito"**: escribe cliente y producto a mano, y la orden
   queda marcada como sin enlace, a la vista. **Nunca se le sugiere un remito
   parecido.**

**Odoo es lento** (30 s de timeout en el cliente). La lista de remitos se trae
al abrir la pantalla y se refresca con un botón, no en cada tecla. Son 25 filas.
Y toda lectura va con `allowed_company_ids` de las dos empresas: si el usuario
bot tiene una sola habilitada, Odoo filtra en silencio con HTTP 200.

### Corregir

Una orden cerrada se edita: los cuatro horarios, las notas, el enlace al remito.
**Sin campo motivo**, sólo rastro de `actualizado_por` y `actualizado_en`: es lo
que ya hace Producción con los partes, que también se transcriben y también se
equivocan, y no vale que dos módulos del mismo sistema resuelvan lo mismo
distinto.

### `/despacho/ordenes` — el histórico y los números

Lista filtrable por fecha, cliente, material, envase y empresa, con los filtros
en la URL como Inventario (`filtrosUrl.ts`). Arriba, lo que la planilla no da
hoy: **tiempo promedio de carga y de permanencia** del período filtrado, y los
peores casos. Recharts ya está en el proyecto.

`traerTodo()` de `lib/core/paginado.ts` en toda consulta de esta tabla: son ~25
órdenes por día, o sea que pasa las 1000 filas en mes y medio, y PostgREST corta
en 1000 sin avisar.

### `/despacho/productos` — el mapeo

Pantalla de administración: los productos de Odoo que aparecieron en remitos,
con su clasificación o **"sin clasificar"**, ordenados por cuántas órdenes los
usaron. Mapear los primeros cinco cubre casi todo, y lo que falta se ve.

## La planilla

**Se escribe al cerrar la orden** (salida del predio), no en cada botón: una
escritura por orden, no cuatro. Si después se corrige, se reescribe esa fila
usando `sheets_fila`.

Si Google rechaza: queda `sheets_pendiente` con **lo que dijo Google sin
traducir**, se le avisa en pantalla a quien apretó, y se cuenta en el inicio —el
contador ya existe en `app/api/home/resumen/route.ts` para Compras, Inventario y
Producción. Un fallo de escritura no es un `console.warn`: eso costó una tarde
entera en Compras.

Variables nuevas: `GOOGLE_SHEETS_DESPACHO_ID` y `GOOGLE_SHEETS_DESPACHO_TAB`.
Sin la primera el espejo no escribe y la orden queda pendiente, igual que
Producción.

### El histórico

Se importa una vez. Las filas viejas entran **sin enlace a Odoo**: enganchar dos
años de órdenes a remitos por nombre de cliente es exactamente lo que no se
hace. `cliente_raw` y `producto_raw` con lo que dice la planilla, y
`odoo_picking_id` en null.

`traerTodo()` para leer, y `fechaDeSheets()` para las fechas: van en **d/m, no
en m/d** — leerlo al revés dio vuelta 885 fechas en Compras.

**La trampa de las horas.** Las columnas de hora no traen fecha. Para armar un
`timestamptz` hay que pegarles la fecha de la orden, y un camión que sale a las
00:30 daría un tiempo en predio negativo. La regla es explícita: **si un horario
es menor que el anterior, es del día siguiente.**

## Permisos

|  |  |
|---|---|
| `lectura` | ve la cola del día y el histórico |
| `edicion` | además da de alta órdenes, marca horarios y corrige |
| `admin` | además edita el mapeo de productos |

`lib/despacho/auth.ts` calcado de `lib/produccion/auth.ts`, y en la base
`tiene_acceso_despacho()`, `puede_editar_despacho()` y `es_admin_despacho()`.
**Las dos mitades tienen que decir lo mismo**: cuando no coincidieron, en la
`029`, un `admin_sistema` veía los botones y RLS le devolvía listas vacías.

El módulo entra en `MODULOS_ORDEN` de `lib/core/access.ts`, en el tipo `Modulo`
de `lib/core/types.ts` y en `lib/core/nav.ts`.

## Migraciones

**Dos archivos, y los corre el usuario a mano en el editor SQL de Supabase.** Un
agente no puede correr DDL.

1. `<ts>_despacho_enum_del_modulo.sql` — **una sola sentencia**: `alter type
   modulo add value if not exists 'despacho'`. Viaja solo porque Postgres no
   deja usar un valor de enum hasta que la transacción que lo agregó commiteó, y
   el editor de Supabase corre cada script en una transacción: compartir archivo
   con cualquier cosa que mencione el valor —incluso el cuerpo de una función,
   que se valida al crearla— falla con `55P04`. Precedentes: `015`, `045`,
   `20260907154332`.
2. `<ts>_despacho_schema.sql` — tablas, permisos y RLS.

El nombre lleva marca de tiempo y no contador (`npm run migracion`), porque dos
sesiones toman el mismo próximo número libre y chocan. **Y hay otra sesión
activa en este árbol**: durante el diseño de este spec el HEAD pasó de `48d8866`
a `5c2bcf7`.

## Qué se testea

Vitest sobre funciones puras, que es donde están las decisiones:

| Función | Qué prueba |
|---|---|
| `estadoDeLaOrden` | los cinco estados, y que un horario salteado no invente uno |
| `tiemposDeLaOrden` | carga y permanencia, **incluido el cruce de medianoche** |
| `clasificacionDe` | devuelve null cuando el producto no está mapeado; nunca adivina |
| `filaDeLaPlanilla` | cómo se aplastan los tres campos en la celda de texto |
| `parsearHoraDePlanilla` | el formato de la planilla, y qué pasa con una celda vacía |

Las rutas y las pantallas no tienen tests, así que la lógica que importa se saca
de la ruta a `lib/`.

## Lo que falta saber

**La planilla no está compartida** con
`sheets-reader@mantenimientopp.iam.gserviceaccount.com`, y las credenciales de
Google no están en local: sólo funcionan en el deploy. Falta:

- Con qué convención se escribe la columna `Material` (los tres campos
  aplastados). `filaDeLaPlanilla` se escribe con un supuesto declarado y se
  ajusta cuando se pueda leer.
- El formato de las cuatro columnas de hora.
- Confirmar que `Tiempo de Carga` y `Tiempo en Predio` son fórmulas.
- Cuántas filas arrastra, para el importador del histórico.

**El pesaje**, si existe en algún lado.
