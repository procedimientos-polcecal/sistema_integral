# Recepción de carbonilla: la balanza, la orden y la planilla

Acordado el 11 de septiembre de 2026. Es el segundo de los cinco frentes de
Despacho; el primero fueron las
[órdenes de carga](2026-09-08-despacho-ordenes-de-carga-design.md).

## El circuito, como lo contó quien lo hace

Llega un camión de carbonilla. Nico lo pesa cargado y anota el **bruto**; el
camión descarga; lo pesa vacío y anota la **tara**. Con el neto genera en Odoo
una **orden de compra sin precio por tonelada**, porque el carbonillero no se va
sin un papel. Esa orden se marca como **recibida**, que es lo que después deja
cargarle la factura. Y al final el dato se transcribe a una planilla de Sheets.

Tres sistemas para un camión: la balanza, Odoo y la planilla.

## Lo que se midió antes de diseñar (11/09/2026)

**La planilla** (`1N5y09kgCMAs5U4uj_D4EcSH-xlJIcZdnlQMX7nlUVVc`), dos pestañas:
`RESUMEN POR DIA ` —con espacio al final— y `Detalle`.

| | |
|---|---|
| Renglones en `Detalle` | **567**, del 09/09/2025 al 10/09/2026 |
| Días con carga | 231 — **2,5 camiones por día**, hasta 10 |
| Toneladas en el año | **11.221**; promedio 19,79 por camión (4,1 a 44,36) |
| `Fecha`, `Proveedor`, `Cantidad` | 100% con dato |
| `Notas` | 10% — casi todas el material: `Carbon de Coke`, `Coque`, `COKE` |
| `Nro Orden` | **20%** (118), como `orden 1615` |
| `LUGAR DE DESCARGAR` | **18%** (107): `ARRIBA` 83, `ABAJO` 23 |
| `Total del Dia ` | **0%**: está vacía en las 567, y vive como fórmula en la otra pestaña |
| Textos distintos de proveedor | **51** para ~10 reales (`Bruzzone`/`bruzzone`, `Walkimia`/`WALKIMIA`, `Fillia`/`Filia`) |

**Odoo**, órdenes de compra de carbonilla del último año:

| | |
|---|---|
| Órdenes | **577** — una por camión, contra 567 renglones de planilla |
| Nombre | `P#####`, estado `purchase` (574) |
| Líneas por orden | **570 tienen una sola**; 7 tienen dos, y la segunda es `FLETE` |
| Unidad | **441 en Toneladas, 136 en "Unidades"** — que también son toneladas |
| Facturadas | 272; **298 siguen `to invoice`** |

**`orden 1615` es la `P01615`.** De los 118 números de la planilla, 116 existen
en Odoo y 104 tienen la misma fecha; los otros son órdenes cargadas el lunes
siguiente. Los proveedores atan: `Filia` → `FILLIA ERNESTO MIGUEL`.

**El precio nace simbólico y se corrige al facturar.** Esto lo decide todo:

| | Simbólico (≤$2) | Real |
|---|---|---|
| Sin facturar | **287** | 3 |
| Facturadas | 97 | **190** |

Agosto y septiembre de 2026 —lo más nuevo, todavía sin facturar— son 56
simbólicas y **cero** reales. O sea que el precio no se sabe en la recepción y
aparece cuando llega la factura. El
[spec de facturación](2026-09-04-facturacion-proveedores-odoo-design.md) había
medido ese patrón (`CARBONILLA, 16,52 unidades a $2,00`, 1.687 de 2.877 líneas
≤ $2) y concluido que la orden de compra se usa **como documento de recepción de
material a granel**. Este circuito es la explicación de ese número.

**Y lo que hoy se pierde entero: el pesaje.** Ni Odoo ni la planilla guardan el
bruto y la tara. Sólo sobrevive el neto.

## Qué guarda el SdG

### `despacho_recepciones`

Una fila por camión.

| Campo | Por qué |
|---|---|
| `fecha`, `empresa_id` | 575 de 577 órdenes son de Polcecal; la empresa igual se elige, porque el vínculo del proveedor con Odoo es **por empresa** |
| `proveedor_id` | Al catálogo del núcleo. Nunca texto libre: es de donde salen los 51 nombres |
| `odoo_product_id`, `odoo_product_nombre` | Qué se recibió. Cacheado el nombre, como en el catálogo de productos |
| `peso_bruto_kg`, `peso_tara_kg` | **Lo único nuevo del mundo.** En kilos, que es lo que dice la balanza |
| `lugar_descarga` | `ARRIBA` / `ABAJO`. Dos valores, no texto libre: es lo que dicen los 107 renglones que lo tienen |
| `notas` | Lo que hoy va en `Notas`, que suele ser el tipo de material |
| `odoo_purchase_order_id`, `odoo_purchase_name`, `odoo_picking_id` | El rastro de los tres pasos en Odoo |
| `odoo_error`, `odoo_error_en` | Qué dijo Odoo cuando falló, **sin traducir** |
| `sheets_fila`, `sheets_pendiente`, `sheets_pendiente_en` | El espejo, igual que las órdenes de carga |
| `cargado_por` / `cargado_en` / `actualizado_por` / `actualizado_en` | Transcribir se equivoca |

**El neto no se guarda: se despeja** (`bruto − tara`), como los tiempos de la
orden de carga y por el mismo motivo — un valor derivado guardado se
desincroniza y nada avisa.

**El estado tampoco**: una recepción está *esperando el bruto*, *descargando*,
*lista para cerrar* o *cerrada*, y eso es cuál de los dos pesos falta más si ya
tiene orden. Se despeja al leer.

### `despacho_recepcion_proveedores`

Qué producto de Odoo le corresponde a cada carbonillero, y cómo se lo nombra en
la planilla.

| Campo | Por qué |
|---|---|
| `proveedor_id` | Clave primaria |
| `odoo_product_id`, `odoo_product_nombre` | Membranex trae `Carbonilla de coque` (58 de 64); el resto, `CARBONILLA`. **Se elige por id y nunca por nombre**: en Odoo hay dos productos que se ven idénticos, `CARBONILLA` y `CARBONILLA ` con un espacio al final |
| `nombre_planilla` | `Bruzzone`, no `BRUZZONE JUAN ALBERTO`. La planilla la siguen leyendo personas que tienen un año de historia escrito así |

Es la misma decisión que el mapeo de productos de Despacho: **no se deduce, se
carga una vez por proveedor**, y lo que falta se ve.

## La pantalla

La misma forma que la cola del día, porque es el mismo problema: alguien
esperando al lado de un camión.

Una fila por recepción del día y **un solo botón, el del próximo paso**:
*Pesar bruto* → *Pesar tara* → *Cerrar*. Con un camión afuera, cuatro botones
son cuatro oportunidades de apretar el que no es.

Al cerrar, el SdG crea la orden en Odoo y **muestra el número en grande**
(`P02421`), que es lo que el carbonillero se lleva anotado.

El peso se tipea: no hay integración con la balanza y este spec no la trae.

## Odoo: los tres pasos, en una acción

Al cerrar, y en este orden:

1. **Crear** la orden de compra (`purchase.order`) con una línea.
2. **Confirmar** (`button_confirm`): pasa a `purchase` y recibe su `P#####`.
3. **Validar la recepción** del picking que la confirmación generó.

Cuatro decisiones que salen de lo medido:

- **Siempre en Toneladas.** Hoy 136 líneas dicen "Unidades" para la misma cosa.
  El SdG deja de producir esa inconsistencia; las viejas quedan como están.
- **Una sola línea.** 570 de 577. El flete es la excepción y queda afuera: si
  algún día hay que sumarlo, se agrega en Odoo a mano.
- **Precio simbólico**, el mismo que usa el circuito. Queda anotado que esto
  perpetúa lo que la factura después reprecia a mano: es fiel al circuito real,
  donde en la recepción el precio no está acordado.
- **Nada de ids fijos en el código.** El producto, el impuesto y el
  `picking_type_id` se resuelven contra *esta* base de Odoo, como ya hace
  `lib/odoo/contexto.ts`. La instancia lleva el id del build en el nombre.

**Los tres pasos se guardan apenas ocurren.** Si la validación del picking falla
después de que la orden se creó, la fila queda con `odoo_purchase_order_id` y
con el error anotado: el reintento valida lo que falta y **no crea una segunda
orden**. Es la misma lección que `empujarOrdenesDeRequerimiento`, donde mandarle
al proveedor el mismo pedido dos veces era el error más caro.

### Si el pesaje se corrige después

Corregir un peso después de que la orden existe **cambia el neto**, y el neto ya
viajó a Odoo. El SdG no reescribe la orden: muestra el desvío y pide que se
corrija en Odoo, que es donde vive la contabilidad. Reescribir una orden
confirmada —o peor, una ya facturada— desde acá es el tipo de cosa que no se
nota hasta el cierre del mes.

## La planilla

Espejo de una sola vía, como Producción y las órdenes de carga: **manda el
sistema**. Se escribe al cerrar, `sheets_fila` para que una corrección reescriba
la misma fila, y si Google falla queda `sheets_pendiente` con lo que dijo Google
**sin traducir**.

Escribe `Fecha`, `Proveedor`, `Cantidad`, `Notas`, `Nro Orden` y
`LUGAR DE DESCARGAR`. **No toca `Total del Dia`**, que está vacía en las 567
filas y se calcula en la otra pestaña: pisar una fórmula la convierte en dato
muerto.

Y la misma decisión que la columna `Material` de las órdenes de carga: **de acá
en más el proveedor se escribe con una sola ortografía**, la del libro
(`nombre_planilla`), no la razón social de Odoo. Hoy hay 51 formas para diez
proveedores.

## Qué se testea

Vitest sobre las funciones puras:

- `netoDeLaRecepcion`: bruto − tara, en kilos, y a toneladas con dos decimales
  para la planilla y para Odoo. Incluido el caso feo: **tara mayor que bruto**,
  que es un error de tipeo y tiene que verse, no convertirse en un neto negativo
  que viaje a una orden de compra.
- `estadoDeLaRecepcion` y `proximoPaso`: qué botón mostrar.
- `filaDeLaPlanilla`: las seis celdas, con la fecha en d/m y el número con coma,
  y la columna `Total del Dia` intacta.
- `valoresDeLaOrden`: los `vals` exactos que se le mandan a Odoo, sin red —
  como `ordenDeCompra.ts`, para poder verlos antes de mandarlos.

## La migración

Un archivo: las dos tablas, sus índices, RLS con las funciones de Despacho que
ya existen, y el enum `despacho_lugar_descarga` **en su propio archivo** si
hiciera falta un valor nuevo (la trampa del `55P04`). Acá no: nace con los dos
valores medidos.

## Lo que falta de una persona

**Los CUIT de seis proveedores.** De los 10 con rubro `CARBONILLA` en el SdG,
sólo 4 están vinculados a Odoo (`proveedores_odoo`), y el vínculo va **por
CUIT** — la lección de [ODOO-INTEGRACION.md](../../ODOO-INTEGRACION.md), donde
cruzar por nombre dio 147 CUITs duplicados. Sin vínculo, el SdG no puede crear
la orden de ese proveedor.

Los que faltan son los que más traen: **Bruzzone (176 órdenes), Puricelli (105),
Sosa (54) y Fillia (44)** — el 66% de los camiones —, más Carbonella SRL y
Moyano. Se cargan el CUIT o se enlazan a mano con la pantalla de vínculo con
Odoo, que ya existe.

**El producto y el nombre de planilla de cada carbonillero**, una vez por
proveedor.

## Lo que queda afuera a propósito

- **El precio.** Ver arriba: no se sabe en la recepción.
- **La balanza conectada.** El peso se tipea.
- **El flete.** 7 de 577.
- **Los otros tres frentes del área**: programación del día, stock de producto
  terminado y pedidos de clientes.
- **Importar el año de historia de la planilla.** Se puede hacer después con la
  misma forma que el importador de órdenes de carga; no bloquea nada, y las
  órdenes viejas ya están en Odoo.

## Riesgos asumidos

- **El SdG confirma órdenes y valida recepciones en la contabilidad del grupo.**
  Es más profundo que lo que hace Compras hoy, que sólo crea. Lo mitiga que sea
  idempotente por construcción y que cada paso se guarde apenas ocurre.
- **Un neto mal tipeado se convierte en una orden de compra confirmada.** El
  sistema avisa si la tara es mayor que el bruto o si el neto se va de los
  límites vistos en un año (4,1 a 44,36 toneladas), pero no bloquea: el papel es
  el papel, y un camión puede traer algo fuera de rango.
- **La planilla y Odoo pueden divergir** si alguien corrige la orden en Odoo: el
  SdG no la vuelve a leer. Es la misma decisión de una sola vía que Producción, y
  el mismo riesgo escrito.
