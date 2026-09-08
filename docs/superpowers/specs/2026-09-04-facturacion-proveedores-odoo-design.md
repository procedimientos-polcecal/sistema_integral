# Facturación de proveedores — el buzón y la orden de compra en Odoo

Diseño acordado el 4 de septiembre de 2026. Se apoya en
[la integración con Odoo](../../ODOO-INTEGRACION.md), que tiene el terreno, los
ids de las dos empresas y el cruce de proveedores por CUIT.

## El problema, dicho como lo dijo quien lo tiene

**"Quiero acelerar el proceso de carga de facturas."** No es control, no es
visibilidad, no es aprobación de pagos: es que cargar una factura de proveedor
cuesta demasiado tiempo. Lo que lo hace lento, según quien carga: hay que tipear
todo desde el PDF o el papel, y **no existe la orden de compra previa**.

Ese segundo punto es la causa y no el síntoma. En Odoo, una factura generada
**desde una orden de compra** viene con ítems, cantidades, precios, impuestos y
cuentas ya puestos: cargarla es revisar y confirmar. Una factura cargada de cero
es transcripción pura.

Y los números del diagnóstico dicen que ese camino hoy casi no se usa:

| Empresa | Órdenes de compra | Facturas de proveedor |
|---|---|---|
| Polcecal S.A | 2.133 | 3.780 |
| Polysan S.A | 162 | 2.488 |

Polysan tiene 2.488 facturas y 162 órdenes. Se está cargando de cero casi todo.

Mientras tanto, el módulo Compras del SdG **ya produce exactamente el dato que
falta**: el requerimiento sabe el proveedor, la cotización elegida, el precio, la
cantidad, para qué equipo o sector es y quién lo aprobó. Ese dato hoy muere en el
SdG y se vuelve a tipear en Odoo.

## Qué se construye

Dos caminos, un solo buzón de entrada. Las facturas llegan por mail, en papel y
por WhatsApp —las tres, según el proveedor—, así que la puerta tiene que aceptar
cualquiera de las tres.

**Camino con orden de compra.** Al aprobarse un requerimiento con proveedor y
costo definidos, el SdG **crea la orden de compra en Odoo, en borrador**, con el
proveedor enlazado por CUIT y una línea por lo pedido. Si el requerimiento es
AMBAS, son dos órdenes al 50% (el reparto vive en
`lib/compras/repartoAmbas.ts`, y el por qué de que sean dos órdenes está en
[la doc de integración](../../ODOO-INTEGRACION.md)). Cuando llega la factura, el buzón la identifica,
la vincula al requerimiento y le dice a contabilidad *"esta factura corresponde a
la OC P02416 de Polcecal"*. Contabilidad la genera desde la orden y postea.

**Camino sin orden de compra.** Servicios, impuestos, ARCA —que figura como
proveedor en la base— y todo lo que nunca fue un requerimiento. La factura se
registra igual en el buzón: queda el archivo, el proveedor, el número, la fecha y
el importe, identificados por QR. El SdG **no la crea en Odoo**; contabilidad la
carga como hoy, pero con el dato ya legible y el respaldo a mano.

## Qué NO hace, explícitamente

- **No postea nada en Odoo.** Ni un asiento. El SdG propone, un humano confirma.
  Es la regla de la integración y acá no se toca: un `account.move` posteado es
  inmutable y la numeración fiscal la asigna Odoo.
- **No emite facturas ni habla con ARCA.**
- **No reemplaza la carga contable de las facturas sin OC.** Esa la sigue
  haciendo administración en Odoo.
- **No toca impuestos ni percepciones.** Los pone Odoo al generar la factura
  desde la orden.
- **No enlaza proveedores por nombre.** Nunca. Ver más abajo.

## Los datos

### El módulo es el sexto, y el enum viaja solo

`facturacion` se suma al enum `modulo` que usa `usuario_modulos`. **Ese valor va
en su propia migración, sin nada más**: Postgres no deja usar un valor de enum
hasta que la transacción que lo agregó commiteó, y el editor de Supabase corre
cada script en una transacción. Falla con `55P04`. Ya pasó con la `015`
(compras) y con la `045` (inventario). Son dos migraciones.

### `facturas_proveedor` — el buzón

Una fila por factura recibida, sin importar por dónde entró.

| Campo | Para qué |
|---|---|
| `empresa_id` | A cuál de las dos se le facturó |
| `cuit_emisor`, `tipo_comprobante`, `punto_venta`, `numero` | La identidad fiscal del comprobante |
| `fecha`, `importe_total`, `moneda`, `cae` | La cabecera |
| `proveedor_id` | El del SdG, enlazado por CUIT. **Null si no hay certeza** |
| `requerimiento_id` | El RI que la origina, si existe |
| `archivo_url` | El PDF o la foto, en Supabase Storage |
| `origen` | `mail` / `papel` / `whatsapp` / `carga manual` |
| `identificado_por` | `qr` o `a mano` |
| `estado` | `recibida` → `vinculada` → `informada` → `contabilizada` |
| `odoo_move_id` | La factura en Odoo, cuando aparezca |

**`identificado_por`** distingue un dato leído del comprobante de uno tipeado por
una persona. Si mañana un importe no cuadra, la primera pregunta es cuál de las
dos cosas fue. Sin la columna, los dos casos son indistinguibles.

**La clave natural** es `(cuit_emisor, tipo_comprobante, punto_venta, numero)`,
con índice único **común, no parcial** —un índice parcial no sirve como destino de
`ON CONFLICT` y rompe cualquier upsert, trampa nº2 del README de migraciones—.
Resuelve algo que con tres vías de entrada es cuestión de tiempo: la misma
factura llega por mail y en papel y se carga dos veces. El segundo intento
muestra la que ya estaba.

### `compras_odoo_ordenes` — el vínculo con la orden

Misma forma que `proveedores_odoo`: clave `(requerimiento_id, empresa_id)`,
`odoo_order_id` y `odoo_nombre` (el `P02416`, que es lo que hay que decirle a
contabilidad), más `porcentaje` para las AMBAS. Una fila por empresa porque un
requerimiento compartido son dos órdenes.

### `compras_requerimientos.odoo_pendiente`

Si la creación de la orden falla, el requerimiento **no queda mudo**. Es el mismo
patrón que `sheets_pendiente`: se guarda el pendiente con lo que dijo Odoo, sin
traducir, y se le muestra a quien aprobó. Un fallo de escritura no es un
`console.warn`.

### `empresas.cuit`

Hoy no existe y hace falta para leer el QR: el código trae el CUIT del receptor,
o sea que **dice a cuál de las dos empresas se le facturó**. Se llena leyendo
`res.company.vat` de Odoo.

## El lector de QR

Función pura en `lib/facturacion/qrAfip.ts`. El QR de un comprobante electrónico
argentino es una URL con un JSON en base64: versión, fecha, CUIT del emisor,
punto de venta, tipo y número de comprobante, importe, moneda, cotización, tipo y
número de documento del receptor, y CAE.

Devuelve la cabecera normalizada **o un motivo de falla**. Ante cualquier duda no
adivina: el formulario queda para carga manual con `identificado_por = 'a mano'`.
Un importe mal leído es peor que un campo vacío.

**Hay que confirmarlo contra tres facturas reales antes de construir la
pantalla.** El formato está documentado por AFIP, pero si no es el que se supone,
es mejor saberlo antes.

### Dependencias nuevas

`jsqr` (12 KB) para decodificar el código de una imagen y, en la etapa 3,
`pdfjs-dist` para rasterizar un PDF antes de buscar el QR. Las dos corren **en el
navegador**, al subir el archivo: no agregan nada al servidor ni consumen
créditos de ningún servicio.

## Los errores, y qué hace el sistema con cada uno

| Falla | Qué pasa |
|---|---|
| El QR no se lee (foto mala, papel arrugado, factura sin QR) | El buzón acepta igual: carga manual. **Nunca se bloquea la entrada** |
| El CUIT del emisor no está en el padrón | `proveedor_id` en null y se informa. No se enlaza al que se le parece |
| El CUIT del receptor no es de ninguna de las dos empresas | Se avisa: o la factura no es del grupo, o `empresas.cuit` está mal |
| La misma factura entra dos veces | La clave natural la detecta y muestra la existente |
| Odoo rechaza la orden | `odoo_pendiente` con el mensaje real de Odoo, visible para quien aprobó |

Y una que va a pasar seguido: **el proveedor puede no existir en la empresa que
corresponde.** Hay 262 proveedores en Polcecal, 237 en Polysan y sólo 147 en las
dos. Si un requerimiento de Polysan tiene un proveedor que en Odoo sólo existe en
Polcecal, la orden no se puede crear, y el mensaje tiene que decir exactamente
eso —*"hay que dar de alta este proveedor en Polysan"*— y no "error al crear la
orden".

## Cómo se verifica

Vitest sobre las funciones puras, que es donde están las decisiones: el lector de
QR con payloads reales, el armado de los `vals` de la orden desde un
requerimiento, la detección de duplicados. El 50/50 ya está hecho y probado.

Hay algo que ningún test contesta: **si Odoo acepta la orden con los campos que
le mandamos.** Se probó en la base de **staging**
(`polcecal-staging-37495859`, en `polcecal-staging-37495859.dev.odoo.com`, con la
misma API key), creando órdenes de verdad y borrándolas. Tres cosas que sólo se
supieron así:

**`product_id` sí es obligatorio, aunque `fields_get` diga que no.** El campo no
está marcado como requerido, pero hay una **restricción SQL** del modelo
—`accountable_required_fields`— que exige `product_id`, `product_uom` y
`date_planned` en toda línea facturable. El primer intento murió con "Missing
required fields on accountable purchase order line". La API mintió y el ORM no.

No hace falta mapear el catálogo igual: la descripción del requerimiento va en el
`name` de la línea —que es lo que se ve e imprime— y el producto sólo aporta
cuenta y unidad. **El grupo ya tiene el producto genérico hecho**: `ART. VARIOS`
(id 6835), sin empresa, o sea compartido por las dos.

**El impuesto es por empresa.** El mismo "IVA Compras 21%" es el id **4** en
Polcecal y el **73** en Polysan, porque en Odoo los impuestos pertenecen a una
empresa. Usar el de la otra no da un error prolijo: da un asiento en la
contabilidad equivocada. Es el 21% porque es lo que usan —343 de las últimas 400
líneas de orden—; las excepciones (0%, exento, no gravado) las corrige
contabilidad en el borrador, que es para lo que el borrador existe.

**Borrar una orden requiere cancelarla primero.** `unlink` sola falla con
"Primero debe cancelar la orden de compra para poder eliminarla". Importa para
limpiar pruebas, y para cualquier corrección futura.

La prueba de punta a punta pasó la salida de `armarOrdenes` por un `create` real:
un requerimiento compartido de 4 unidades a $1.000 con 10% de descuento y $100,01
de flete generó **P02424 en Polcecal por $1.850,01 neto y P02425 en Polysan por
$1.850**, que suman exactamente **$3.700,01**. El centavo impar cayó en una sola
de las dos, que es todo el punto de `repartirAmbas`. Las dos se borraron.

## Con qué datos cuenta la etapa 1 hoy (medido el 04/09/2026)

Esto se midió después de escribir el código, y cambia la expectativa: **el push
no tiene nada sobre lo que disparar todavía.**

| | |
|---|---|
| Cotizaciones cargadas | 312 |
| Cotizaciones **elegidas** | **0** |
| RIs con `estado_compra = APROBADO` | 35 |
| De ésos, con costo cargado | **0** |
| RIs con costo cargado (histórico de la planilla) | 1.675 |

O sea que la orden de compra se va a empezar a crear **para los requerimientos
nuevos que pasen por la comparativa**, no para lo que ya está. Los 1.675
históricos vinieron importados de la planilla con el costo ya puesto y sin
cotización, y son compras cerradas: no necesitan orden.

Y hay una razón para **no** usar el costo del requerimiento como precio: el campo
se llama `costo_iva` y es literalmente eso, el total **con IVA** (ver
`costosParaElPedido` en `lib/compras/comparativa.ts`). Ponerlo como `price_unit`
de una línea con impuesto del 21% cobraría el IVA dos veces. La cotización
elegida, en cambio, tiene `precio_unitario` neto, que es lo que una línea de orden
necesita. Por eso el push exige la cotización y no acepta el costo del RI: no es
rigidez, es que el otro número no sirve para esto.

## Las etapas

**Etapa 1 — El push de la orden de compra.** Sin buzón. Al aprobarse un
requerimiento, la orden aparece en Odoo en borrador, con el vínculo guardado y el
número visible en la pantalla del requerimiento.

Se entrega sola y ya acelera la carga sin que el módulo exista: contabilidad
empieza a generar facturas desde la orden. Requisito previo: aplicar la migración
de `proveedores_odoo` y escribir los 122 enlaces, porque sin eso no hay
`partner_id` que poner.

**Etapa 2 — El buzón.** El módulo `facturacion` (dos migraciones por el enum),
`facturas_proveedor`, la subida a Supabase Storage, el QR de imágenes con `jsqr`,
la detección de duplicados, el vínculo al requerimiento y la cola de "listas para
cargar".

**Etapa 3 — PDFs y cierre del círculo.** `pdfjs-dist` para leer el QR de un PDF,
y detectar por el pull incremental cuándo la factura ya apareció en Odoo para
cerrarle el estado.

## Lo que queda abierto

1. ~~El impuesto de las líneas~~ **resuelto**: IVA Compras 21%, id 4 en Polcecal
   y 73 en Polysan, leído de lo que ya usan.
2. ~~Dónde se prueba el primer write~~ **resuelto**: staging
   (`polcecal-staging-37495859`), y ya se probó ahí.
3. **Tres facturas reales en PDF** para confirmar el formato del QR. Bloquea la
   etapa 2, no la 1.
4. **Por qué Polysan factura sin órdenes de compra.** Es una pregunta para
   administración. Si la respuesta es "porque casi nada pasa por un
   requerimiento", la etapa 1 rinde mucho menos de lo que parece y conviene
   saberlo antes.
5. **Si el push corre contra producción o staging.** El código toma la base de
   `ODOO_DB`, así que es configuración, no código: se puede dejar apuntando a
   staging hasta que administración valide un par de órdenes de verdad.
