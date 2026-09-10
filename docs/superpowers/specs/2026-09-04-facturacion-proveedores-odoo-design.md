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

**Confirmado el 10/09/2026 contra las 139 facturas de `FACTURAS/SEPTIEMBRE
2026`** — no tres, la carpeta entera. Los trece nombres de campo son los que dice
la especificación. Lo que la carpeta agregó, y que no se deducía:

- **Un QR pegado a una línea del formulario no se lee.** El estándar pide una
  zona de silencio de cuatro módulos y muchos emisores lo imprimen dentro de un
  recuadro que lo toca. El lector le agrega el margen que el emisor no dejó.
- **La resolución hay que escalonarla**: 84 se leen a 1600 px de ancho, 15
  necesitan 2600 y 8 necesitan 3600.
- **La página dibujada puede deformar el QR.** El de TODO RULEMAN es una imagen
  de 330×330 que el PDF estira; estirado no se lee. Leerla a resolución nativa lo
  arreglaría, pero **desde el navegador no se puede**: pdf.js decodifica las
  imágenes con `OffscreenCanvas` en el worker y no manda los píxeles al hilo
  principal. Funciona en Node y no en un navegador, así que esa pasada se escribió,
  midió bien, se comprobó en el navegador y se sacó.
- **Hay QR que no son de ARCA** en la misma hoja (SPETTER trae uno de
  `gestionaguas.ar`). No se usan ni siendo el único.
- **Hay emisores que rompen el QR y sirve igual**: coma decimal y payload
  truncado (Pedro H. Camino), JSON sin base64 (BERNER), base64 partido en líneas
  de 72 caracteres (TORRACO).

El detalle y las decisiones que salieron de ahí están en
[docs/FACTURACION.md](../../FACTURACION.md).

### Dependencias nuevas

`jsqr` (12 KB) para decodificar el código de una imagen y `pdfjs-dist` para
rasterizar un PDF antes de buscar el QR. Las dos corren **en el navegador**, al
subir el archivo: no agregan nada al servidor ni consumen créditos de ningún
servicio.

**`pdfjs-dist` pasó de la etapa 3 a la etapa 2**, y no por comodidad: las 139
facturas de septiembre son **todas PDF**. Una etapa 2 que sólo leyera imágenes no
habría leído ninguna factura de verdad. Su worker se sirve desde `public/pdfjs/`,
copiado por `scripts/copiar-worker-pdf.mjs` en `predev` y `prebuild`.

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

## Lo que se vio en producción el 08/09/2026

El ping corrió en el deploy y las nueve sondas pasaron. Dos cosas nuevas, y la
segunda toca la premisa de esta etapa.

**El ritmo de carga, medido.** En cinco días (03→08/09) entraron **96 facturas de
proveedor** y **56 pagos**, y se crearon **10 órdenes de compra** —las diez de
Polcecal, ninguna de Polysan—. Unas 19 facturas por día cargadas a mano: eso es
el problema que este módulo viene a atacar, con número.

**Más de la mitad de las órdenes de compra no tienen precio real.** De 2.877
líneas de orden, **1.687 (59%) tienen `price_unit` ≤ $2** — el patrón es
`CARBONILLA, 16,52 unidades a $2,00`, y hasta el flete va a $2. Sólo 1.024 (36%)
pasan de $1.000, como `BOLSAS CAL GÜEMES 25KG, 30.000 a $373,01`.

O sea que en esta instancia la orden de compra se usa, la mayoría de las veces,
como **documento de recepción de material a granel** y no como documento de
compra con precios. Eso no rompe nada de lo construido —las órdenes que crea el
SdG llevan el precio real de la cotización elegida—, pero **cambia de qué depende
el ahorro**: no alcanza con que la orden exista, hace falta que administración
empiece a facturar *desde* ella. Con las órdenes actuales no podría: generar una
factura desde una orden de $33,04 obliga a repreciar todo a mano.

Conviene confirmarlo con administración antes de esperar el ahorro. Es la misma
conversación que la pregunta abierta sobre por qué Polysan factura sin órdenes.

## El circuito real, y de dónde sale el precio (09/09/2026)

El diseño asumía que la orden nacía de un **presupuesto elegido** en la
comparativa. El circuito del grupo es otro, y con el que estaba la orden **no se
hubiera generado nunca**:

1. **Maxi o Nico aprueban la compra** y le informan al encargado de compras cuál
   fue su elección — hoy, marcando la casilla de la columna ELECCIÓN.
2. El **encargado de compras** pasa el pedido de *para comprar* a *pedido*, y
   carga el proveedor y el precio en Gestión de compra.

O sea que quien registra el dato no es quien decide, y **no queda un presupuesto
elegido**: queda el campo "Costo + IVA" del requerimiento.

**Qué es ese campo, medido:** el total de toda la cantidad, **con IVA**, sin el
envío. El RI 1912 lo prueba — `costo_iva` 7.734,32 con un presupuesto de 6.392 ×
1 al 21%, que es exactamente 6.392 × 1,21.

Por eso el precio de la orden sale de dos lugares, en este orden:

1. el **presupuesto elegido**, si hay: trae el unitario neto tal como se cotizó;
2. el **"Costo + IVA" del requerimiento**, del que `precioDesdeElRequerimiento`
   saca el neto dividiendo por 1,21. Mandarlo tal cual cobraría el IVA dos veces.

Dos cosas que salieron de hacerlo:

- **El flete no lleva IVA.** La fórmula de la comparativa es
  `neto × (1 + IVA) − descuento + envío`: suma el envío **después** del
  impuesto. Gravarlo en Odoo haría que la orden totalice más que la compra
  aprobada.
- **`price_unit` en Odoo tiene dos decimales** (`digits: [16, 2]`), así que hay
  totales que no se reconstruyen exactos. No se esconde: el ensayo muestra el
  total que va a tener la orden junto al costo aprobado.

**La orden se genera sola** al pasar el pedido a *pedido*, con el mismo criterio
que la planilla: el guardado ya está hecho, así que un fallo de Odoo se avisa y
queda en `odoo_pendiente`, con el botón para reintentar.

Verificado contra Odoo con los números del RI 1933 (Casa Camino, $39.022,50, 10
unidades, AMBAS): dos órdenes de $19.511,25 que suman **$39.022,50 exacto**.

## Las etapas

**Etapa 1 — El push de la orden de compra.** Sin buzón. Al aprobarse un
requerimiento, la orden aparece en Odoo en borrador, con el vínculo guardado y el
número visible en la pantalla del requerimiento.

Se entrega sola y ya acelera la carga sin que el módulo exista: contabilidad
empieza a generar facturas desde la orden. Requisito previo: aplicar la migración
de `proveedores_odoo` y escribir los 122 enlaces, porque sin eso no hay
`partner_id` que poner.

**Etapa 2 — El buzón. Entregada el 10/09/2026.** El módulo `facturacion` (dos
migraciones por el enum), `facturas_proveedor`, la subida a Supabase Storage, la
detección de duplicados por la clave natural, el vínculo al requerimiento por
número de RI, y la pantalla que **carga varias a la vez** — con 19 por día, una
pantalla de una factura por vez habría sido una versión más linda de lo que ya
hacen.

Incluye la lectura de PDF, que estaba planificada para la etapa 3: ver arriba.

**Etapa 3 — Cerrar el círculo.** Detectar por el pull incremental cuándo la
factura ya apareció en Odoo y pasarla sola a `contabilizada`. Hoy ese estado lo
pone una persona con el botón "Ya está en Odoo".

## Lo que queda abierto

1. ~~El impuesto de las líneas~~ **resuelto**: IVA Compras 21%, id 4 en Polcecal
   y 73 en Polysan, leído de lo que ya usan.
2. ~~Dónde se prueba el primer write~~ **resuelto**: staging
   (`polcecal-staging-37495859`), y ya se probó ahí.
3. ~~Tres facturas reales en PDF~~ **resuelto**: se midió contra las 139 de
   septiembre. El formato es el esperado; lo que no era el esperado está arriba.
4. **Por qué Polysan factura sin órdenes de compra.** Es una pregunta para
   administración. Si la respuesta es "porque casi nada pasa por un
   requerimiento", la etapa 1 rinde mucho menos de lo que parece y conviene
   saberlo antes.
5. **Si el push corre contra producción o staging.** El código toma la base de
   `ODOO_DB`, así que es configuración, no código: se puede dejar apuntando a
   staging hasta que administración valide un par de órdenes de verdad.
6. **Las facturas que no traen QR.** 12 de las 139 de septiembre son "copia del
   original" sin el bloque de ARCA — todas de ZITO Y PRIOLA, que factura seguido.
   **Esto corrige un supuesto de este spec**: no es que el QR esté dentro de la
   imagen de una página escaneada; no está. Su PDF sí trae el texto completo y
   legible, así que una cuarta pasada que lea el texto las rescataría enteras. Es
   la mejora con mejor relación entre trabajo y facturas ganadas.
7. **Los QR que jsQR no decodifica** aunque se vean impecables (DON ALFREDO,
   RUBIALES, ERGUY). Se probó a 7000 px, con umbral duro y con 274 ventanas: no
   es resolución. Vale probar zxing antes de darlos por perdidos.
8. **El CUIT de los 146 proveedores que no lo tienen.** Odoo lo tiene en
   `res.partner.vat` para los 207 enlazados: un cruce de una sola corrida que
   sube el reconocimiento automático del emisor.
