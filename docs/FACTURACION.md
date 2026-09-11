# Facturación — el buzón de facturas de proveedor

El problema, dicho por quien lo tiene: **"Quiero acelerar el proceso de carga de
facturas."** Cargar una factura cuesta tipearla desde el PDF o desde el papel.
Entran unas **19 por día** —96 en los cinco días entre el 03 y el 08/09/2026— y
llegan por mail, en papel y por WhatsApp, las tres.

El buzón es la puerta única. Entra el archivo, el sistema lee el QR de ARCA, y de
ahí salen el emisor, el número, la fecha, el importe y **a cuál de las dos
empresas se le facturó**, sin tipear nada.

Desde ahí el buzón **deja la factura en borrador en Odoo** —con el proveedor, el
número, la fecha y el importe puestos— y después **averigua solo** cuándo la
postearon. Ver [El vínculo con Odoo](#el-vínculo-con-odoo).

El borrador se puede **revisar y confirmar sin salir del sistema**. Ver
[Confirmar desde el SdG](#confirmar-desde-el-sdg), que cambió una regla y
conviene leer antes de tocarlo.

El diseño acordado está en el
[spec](superpowers/specs/2026-09-04-facturacion-proveedores-odoo-design.md).

## Antes de tocarlo: lo que midió la carpeta de septiembre

Todo lo que sigue salió de correr el lector contra las **139 facturas de
`FACTURAS/SEPTIEMBRE 2026`** — la carpeta completa, no una muestra. Ninguna de
estas cosas se deducía de la especificación de ARCA, y cada una cambió el código.

### El lector necesita dos pasadas, y **110 de 139 facturas se leen solas**

`lib/facturacion/escaneoQr.ts` busca el QR de dos maneras:

| Pasada | Rescata | Por qué existe |
|---|---|---|
| **La página dibujada, subiendo la definición** (1600 → 2600 → 3600 px) | 84 + 17 | Un QR de dos centímetros en una A4 dibujada a 1600 px queda en unos 90 px, y el payload de ARCA —una matriz de 69×69 módulos— no llega a un píxel por módulo. Empezar en 2600 sería pagar el dibujo caro 84 veces; quedarse en 1600 sería perder 17. |
| **Ventanas deslizantes**, sólo si la primera falló y **sólo en la página 1** | 9 | Hasta 274 recortes, unos segundos. La comparación no es contra un segundo: es contra tipear la factura entera. |

Mediana: **495 ms por factura**; peor caso, 32 segundos.

Las ventanas corren sólo en la primera página, y no es una simplificación: en las
139 el QR está siempre ahí, y correrlas en tres páginas llevaba el peor caso a
**53 segundos**. Con 19 facturas por día, eso es la diferencia entre una cola que
avanza y una que parece colgada.

### Un QR pegado a una línea del formulario no se lee

El estándar del QR pide una **zona de silencio** de cuatro módulos en blanco
alrededor, y muchos emisores lo imprimen dentro de un recuadro que lo toca. Por
eso cada recorte se copia al centro de un lienzo blanco más grande antes de
escanearlo: **el margen que el emisor no dejó se lo agrega el lector**. Con eso,
las 8 facturas que necesitaban 3600 px pasaron a leerse a 2600, y AGROINGA —cuyo
QR está pegado al borde de la hoja— pasó a leerse.

Sin ese margen, un QR perfectamente nítido no se decodifica y no hay forma de
darse cuenta mirándolo.

### La trampa: en el navegador no se pueden leer las imágenes embebidas del PDF

Merece un párrafo porque **la primera versión de este lector tenía una pasada que
medía bien y en producción no habría hecho nada**.

La idea era buena. El QR de TODO RULEMAN es una imagen de 330×330 que la página
**estira** a un rectángulo, y un QR estirado no se lee de ninguna manera; a
resolución nativa se lee de una. Así que la pasada 1 pedía las imágenes con
`page.objs.get(...)` y las escaneaba sin pasar por la página.

En el banco de pruebas —Node, con `@napi-rs/canvas`— funcionaba. **En un
navegador de verdad no**: pdf.js decodifica las imágenes con `OffscreenCanvas`
dentro del worker y nunca manda los píxeles al hilo principal, así que
`page.objs.get(...)` tira *"Requesting object that isn't resolved yet"* — antes y
después de dibujar la página. En Node no hay `OffscreenCanvas`, el worker manda
los datos crudos, y de ahí la diferencia.

Se detectó abriendo el navegador y corriendo la pasada con facturas reales
servidas desde `public/`. La lección es la de siempre en este repo, con una
vuelta más: **medir contra datos reales no alcanza si se mide en el entorno que
no es.**

Las facturas con el QR estirado quedan para carga manual.

### Se dibuja con `intent: "print"`, no con el de por defecto

En modo `display` pdf.js dibuja por tandas encadenadas con
`requestAnimationFrame`, y el navegador **lo congela en una pestaña que no está a
la vista**: comprobado, el render nunca termina. Con 19 facturas leyéndose de a
una, alguien va a cambiar de pestaña y la cola quedaría clavada en "leyendo".

Y para lo que hace falta acá es además el intent correcto: se busca un QR
impreso, o sea la página como saldría en papel.

### Hay facturas que no traen QR, y no es un problema del lector

Las **12 de ZITO Y PRIOLA** de septiembre son "copia del original": no tienen el
bloque de ARCA impreso. Se rasterizó la página a 7000 px y se miró el resultado
para confirmarlo.

Esto **corrige un supuesto anterior** que estaba escrito en el spec: que el QR
estaba dentro de la imagen de la página escaneada. No está. Para estas facturas,
o se le pide al proveedor el original, o se completan a mano.

Y hay QR que jsQR no decodifica aunque se vean impecables: DON ALFREDO, RUBIALES
y ERGUY. Se probó a 7000 px, con umbral duro y con 274 ventanas. No es
resolución.

### El QR de un emisor puede venir roto, y sirve igual

Dos formas ya vistas en facturas de verdad:

- **Pedro H. Camino** escribe `"importe":38166,88` —coma decimal, que en JSON no
  es un número— y corta el payload a 255 caracteres. `leerQrAfip` lo extrae campo
  por campo y devuelve `reparado: true`, que la pantalla muestra en amarillo:
  sirve para identificar el comprobante, pero merece una mirada antes de darlo
  por bueno.
- **BERNER** pone el JSON **sin base64** en el parámetro `p`.

### El base64 viene partido en líneas

El de TORRACO viene en líneas de 72 caracteres. Un `[^&\s]+` cortaba el payload
en 72 de 290 y devolvía "no es base64". Se saca todo el espacio antes de decodificar.

## Cómo está armado

| | |
|---|---|
| `lib/facturacion/qrAfip.ts` | Lee el QR de ARCA. Función pura, tolerante a los QR roto y al dominio viejo (`afip.gob.ar`) y al nuevo (`arca.gob.ar`). |
| `lib/facturacion/escaneoQr.ts` | Encuentra el QR en una imagen. No sabe de PDF ni de navegador: recibe "dame los píxeles de este rectángulo". |
| `lib/facturacion/leerArchivo.ts` | Las dos pasadas, con pdf.js. **Corre en el navegador.** |
| `lib/facturacion/candidatos.ts` | Cuál de los QR de la hoja es el del comprobante. |
| `lib/facturacion/comprobante.ts` | Los tipos de comprobante, el número como sale impreso, la clave natural. |
| `lib/facturacion/altaDeFactura.ts` | De lo leído a la fila del buzón: resuelve empresa y proveedor **por CUIT**. |
| `lib/facturacion/consultas.ts` | Los catálogos, el duplicado, el listado. |
| `app/(app)/facturacion/` | La pantalla: cargar de a varias y ver lo que entró. |
| `app/api/facturacion/facturas/` | `POST` cargar, `GET` listar; `[id]` para vincular y firmar el link del archivo. |

### El QR se lee en el navegador, no en el servidor

El archivo se lee en la máquina de quien lo está cargando, así que **los datos
aparecen en pantalla antes de subir nada**: quien carga ve lo que el sistema
entendió y lo corrige ahí mismo. Del lado del servidor, cada corrección costaría
una subida entera.

Como consecuencia, la ruta recibe la cabecera ya leída — pero **no confía en
ella para los enlaces**: `prepararAlta` resuelve la empresa y el proveedor
buscando el CUIT contra la base, así que quién queda enlazado no lo decide el
cliente.

### El worker de pdf.js se sirve desde `public/`

`scripts/copiar-worker-pdf.mjs` lo copia de `node_modules` en cada `npm run dev`
y cada `npm run build` (por `predev` y `prebuild`, así que en Vercel pasa antes de
compilar). No está commiteado: su versión **tiene que coincidir** con la del
paquete instalado o pdf.js aborta, y de esta forma un `npm update` lo arrastra
solo.

No se usa `new URL(…, import.meta.url)` a propósito: qué bundler usa Next 16
cambia entre dev y build, y una falla ahí aparecería recién en el navegador de
quien está cargando una factura — que es donde no la vamos a ver, porque el
módulo está detrás del login.

## Las reglas que no se deducen del código

- **El proveedor y la empresa se resuelven por CUIT, nunca por nombre.** Si el
  CUIT no está en el padrón, el enlace queda vacío y se informa. Es la regla de
  todo el sistema: enlazar al que se le parece es peor que dejar en null, porque
  un enlace equivocado no se nota nunca. Hoy **145 de 291 proveedores tienen
  CUIT**; cargarle el CUIT a un proveedor hace que la próxima factura se
  enganche sola.
- **El buzón no se bloquea nunca.** Una factura sin QR, con el QR roto o
  escaneada de un fax entra igual. Los avisos dicen qué falta; no impiden
  guardar. El módulo existe para que cargar una factura cueste menos: hacerla
  rebotar por un dato faltante sería empeorar justo lo que vino a arreglar.
- **Un QR que no es de ARCA no se usa ni siendo el único de la hoja.** Una
  factura puede traer el QR de un cupón de pago o el de un portal del proveedor
  (SPETTER trae uno de `gestionaguas.ar`). Guardar sus datos pondría en la
  factura el número de otra cosa.
- **La clave natural son cuatro datos: CUIT del emisor, tipo, punto de venta y
  número.** Si falta uno, no hay clave: la factura entra pero no se puede
  detectar como duplicada. **No se completa con ceros** — dos comprobantes
  distintos chocarían en el índice único y el segundo se perdería en silencio.
- **Primero se busca el duplicado y después se sube el archivo.** Al revés
  dejaría un archivo huérfano en el bucket cada vez que alguien carga por segunda
  vez la misma factura, que es un caso esperado con tres vías de entrada.
- **En `archivo_url` va la ruta del Storage, no un link.** El bucket es privado y
  los links son firmados: guardar uno sería guardar un dato que se podre solo. Se
  firma cuando alguien pide abrirlo (`GET /api/facturacion/facturas/[id]`).
- **Borrar no existe.** Una factura que llegó, llegó. Si se cargó mal se corrige
  lo corregible; si no era del grupo, se anota en `notas`.
- **Los datos fiscales no se pueden editar después.** Son la identidad del
  comprobante: cambiarlos lo convertiría en otro. Una cargada con el número
  equivocado se anota y se carga la buena.

## El vínculo con Odoo

Son dos cosas distintas y conviene no mezclarlas: **crear el borrador** (el SdG
escribe en Odoo) y **conciliar** (el SdG lee de Odoo). El código está partido
igual: `lib/facturacion/borradorEnOdoo.ts` y `lib/facturacion/conciliacion.ts`
son puros y se prueban sin red; `lib/odoo/pushFactura.ts` y
`lib/odoo/sincronizarFacturas.ts` hacen los viajes.

### El Odoo del grupo tiene una localización argentina **propia**

Es lo primero que hay que saber, porque decide todo lo demás. No es la estándar
—`l10n_latam.document.type` no existe, y buscarlo hace creer que no hay
localización— sino un juego de módulos propios en `odoo_l10n_ar`
(`l10n_ar_afip_webservices_wsfe`, `l10n_ar_point_of_sale`, `l10n_ar_perceptions`).

Los campos que importan en `account.move`, medidos sobre las 6.423 facturas de
proveedor de la instancia (11/09/2026):

| Campo | Qué es | Cargado en |
|---|---|---|
| `voucher_type_id` | El tipo de comprobante. Su **`code` es el número de ARCA**, el mismo que trae el QR | 6.414 (99,9%) |
| `voucher_name` | El número: `0006-00010192` | 6.412 (99,8%) |
| `full_voucher_name` | `FC A 0006-00010192`, calculado por Odoo | — |
| `name` | `BILL/2026/09/0004`: una **secuencia interna**, nada que ver con el papel. En borrador es `/` | — |

**`voucher.type.code` es el código de ARCA**, con los 88 tipos de la tabla
oficial cargados. O sea que el tipo que viene en el QR no hay que mapearlo a
mano: se busca por código y listo. Los que el grupo no emite están archivados,
así que la búsqueda va con `active_test: false` — un tipo archivado sigue siendo
el tipo correcto de una factura que se recibe.

### Esto se descubrió posteando, no leyendo

El primer borrador se creó perfecto y murió al postearlo:
**"El documento no tiene numero!"**, desde `_validate_supplier_invoice_number`.
Sin `voucher_type_id` y `voucher_name` el borrador **no se puede postear**, o sea
que no sirve para nada: contabilidad tendría que completarlo igual, que es el
trabajo que este módulo vino a sacar.

Con los dos campos puestos, sí. Probado de punta a punta contra la instancia: se
creó el borrador con los datos de una factura real del buzón, se lo posteó, la
sincronización la pasó a `contabilizada`, y después se borró el asiento y se
dejó la fila como estaba.

`ref` queda **sin tocar** a propósito: administración la usa para sus notas
(`REMITOS MEMBRANEX`, `YA PAGADA EN EFECTIVO`) y pisarla sería sacarles un campo
que ya usan para otra cosa.

### El IVA sale de la letra, no de una suposición

El QR trae el importe **con IVA** y una línea de Odoo lleva el neto. Cuál es cuál
lo decide la letra del comprobante, y está medido sobre los 1.143 comprobantes
con referencia cargada:

| Letra | Comprobantes | Con impuesto |
|---|---|---|
| A | 793 | **793 (100%)**, 778 al 21% exacto |
| B | 5 | 5 |
| C | 4 | **0** |

Una A o una B se cargan con IVA 21%; una C no lleva —el monotributista no lo
discrimina— y ponérselo sería inventar un crédito fiscal. Un tipo desconocido va
sin impuesto: un borrador al que le falta el IVA se completa mirándolo; uno con
un IVA que no correspondía se postea sin que nadie lo note.

Dividir el total por 1,21 reproduce el total **exacto en 785 de las 793 facturas
A**, y en las otras 8 queda a menos de dos centavos. No se esconde: el push relee
el `amount_total` que quedó en Odoo y avisa si no coincide.

### La conciliación cruza el número **y** el CUIT

Nunca el importe: el trío (proveedor, fecha, importe) se repite en el **1,4%** de
las facturas de 2026, y sin la fecha en el **14,5%**. Un 1,4% de enlaces mudos y
equivocados es justo lo que este sistema no hace — una factura mal conciliada
aparece como contabilizada y nadie vuelve a mirarla.

Se afirma el vínculo cuando el CUIT del emisor es el del proveedor del asiento,
la empresa coincide, y el `voucher_name` es el número del comprobante. Si además
los dos saben el tipo, tiene que ser el mismo: una nota de crédito y la factura
que revierte pueden llevar el mismo número y son documentos distintos.

**Medido contra los datos reales: de 1.196 facturas de Odoo con número, reconoció
1.196, se equivocó en 0 y no dejó ninguna ambigua.**

### La referencia es sólo el respaldo

Para las 11 facturas de 6.423 que no tienen `voucher_name` se parsea `ref`, que
es texto libre. La primera versión de este módulo se construyó así —antes de
encontrar los campos propios— y los números de esa vuelta explican por qué quedó
degradada a respaldo: de 210 asientos probados reconoció 189, y **21 quedaron
ambiguos porque administración repite la misma referencia en asientos
distintos**: `FC A 00008-00003291` figura en seis facturas de RUBIALES, con seis
importes y seis fechas. Para ellos `ref` es una nota, no una identidad.

Por eso, cuando hay algún candidato por el campo propio, los de la referencia se
descartan enteros. Y `odoo_conciliado_por` distingue `numero` de `referencia`:
uno vino de un campo estructurado y el otro de adivinarle el formato a un texto
escrito a mano.

### Qué hace cada cosa

| | |
|---|---|
| **Crear el borrador en Odoo** | Crea el `account.move` en borrador —postable— y deja la factura en `informada`, con `odoo_conciliado_por = push` |
| **Buscar en Odoo** | Trae los candidatos de ese proveedor, con el motivo por el que están en la lista, para elegir a mano |
| **Sincronizar con Odoo** | Relee los vínculos que hay y busca los que faltan. Lo corre también el cron `/api/cron/facturacion-sync`, a las 9:30 |
| **Ya está en Odoo** | Sigue existiendo: es la marca manual para lo que ninguna regla puede afirmar |

`odoo_conciliado_por` existe por el mismo motivo que `identificado_por` distingue
el QR de lo tipeado: si mañana una factura aparece contabilizada y no debía, la
primera pregunta es si lo dedujo el sistema o lo decidió alguien.

Una línea de `account.move` **no necesita producto**, a diferencia de
`purchase.order.line` —que lo exige por una restricción SQL—: Odoo le pone la
cuenta de gasto que corresponde al proveedor. Y un borrador se borra directo;
cancelar primero es cosa de las órdenes de compra.

## Una línea por producto

El borrador de Odoo salía con **una sola línea por el total**, con la cuenta que
Odoo le pone al proveedor. Alcanza para que la factura exista y no alcanza para
la contabilidad: el gasto de una factura con cuatro ítems distintos cae entero en
una cuenta. Y hace falta — de las 11.048 líneas de factura de proveedor de la
instancia, **9.659 (87%) llevan distribución analítica**.

### El detalle no está en el QR: está en el texto del PDF

El QR trae cabecera y nada más. El detalle sale de `getTextContent()` de pdf.js,
y se lo reconoce **sin plantilla por proveedor** porque no se interpreta el
diseño: se busca aritmética que cierre. Una fila de detalle tiene tres números al
final —cantidad, precio, total— y el tercero es el producto de los dos primeros.

Y hay una segunda red, independiente: **la suma de las líneas tiene que dar el
neto que el QR ya dijo**. Si no da, el detalle no se usa y la factura va con una
línea sola. Dos controles que fallan por motivos distintos son mucho más que dos
controles.

Lo que enseñó la primera factura real (ALMENTA, cuatro ítems):

- **El producto de la fila no da exacto.** 20 × 4.426,45 = 88.529,00 y el papel
  dice **88.528,93**. Siete centavos: la tolerancia tuvo que ser relativa.
- **La descripción trae números que no son columnas** (`428X4/7.5`, `3x2.5mm`),
  así que se toman los **últimos** tres y no los primeros.
- **El pie imita una línea de detalle**: `I.V.A. 10,5% 0,00 0,00` cumple la
  aritmética. Por eso una línea con importe cero no se acepta nunca.
- **El PDF dibuja cada texto dos veces**, y sin deduplicar los últimos tres
  números son los de la segunda copia.

El 66% de las facturas tienen una sola línea (mediana 1, p90 3, máximo 14), así
que esto no cambia el caso común: arregla el 34% donde había que desglosar a mano.

### Producto, cuenta y analítica: quién pone cada cosa

| | Quién | Cómo |
|---|---|---|
| Descripción, cantidad, precio | El papel | No se edita. Si está mal leído, se recarga la factura |
| Producto de Odoo | El sistema propone, una persona corrige | El mismo emparejador que las órdenes de compra, con su tabla de lo aprendido |
| Cuenta contable | Una persona | Odoo pone una por defecto según el proveedor; se puede cambiar |
| Distribución analítica | Una persona, siempre | El comprobante no dice a qué equipo fue un repuesto |

**Corregir el producto enseña.** La corrección va a `compras_producto_odoo`, que
es la misma tabla que usan las órdenes: lo que alguien arregla acá mejora también
la generación de órdenes desde un RI.

Las cuentas y las analíticas **son por empresa** —242 cuentas imputables y 358
analíticas en Polcecal— y se traen recién cuando alguien abre el detalle de una
factura: son ~600 filas que no hacen falta para ver el buzón.

`analytic_distribution` se guarda con la forma de Odoo, `{"<id>": porcentaje}`,
para que no haya traducción en el medio. Los porcentajes suman 100 **con cinco
centésimas de tolerancia**, y eso no es capricho: el gasto de carbonilla del grupo
está repartido entre seis cuentas como `16,67 + 16,66 × 5`, que suma 99,97 y está
posteado. Exigir 100 exacto rechazaría asientos que Odoo aceptó.

### El PDF queda adjunto al asiento

El mismo archivo que el buzón escaneó se sube como `ir.attachment` del
`account.move`, así que quien revisa el borrador tiene el comprobante a mano sin
salir de Odoo. **No frena el push si falla**: el borrador ya existe y vale por sí
solo; un adjunto que no subió se avisa y se reintenta.

Probado de punta a punta contra la instancia: borrador con las cuatro líneas de
ALMENTA, la primera imputada a `5.2.1.01.220 Repuestos` y repartida entre tres
equipos, el PDF adjunto (100.669 bytes), **posteado** como BILL/2026/09/0016 por
1.774.706,11 contra los 1.774.706,10 del papel — el centavo del redondeo de la
tercera línea. Después se borró.

## Confirmar desde el SdG

Hasta el 11/09/2026 la regla era **"el SdG propone, Odoo confirma"**: el SdG
creaba el borrador y una persona lo posteaba en Odoo. A pedido, ahora también se
puede postear desde el buzón. Vale la pena tener presente qué implica:

- **Un asiento posteado es inmutable.** Odoo le asigna la numeración del diario y
  deja de ser editable; corregirlo después es reabrirlo o reversarlo, que es una
  operación contable. **Esto no se deshace desde el sistema**, y es la única
  acción del módulo de la que se puede decir eso.
- Por eso el posteo pide dos cosas que crear el borrador no pedía: una
  confirmación explícita —el botón pregunta de nuevo, con el importe a la vista—
  y que **los números cuadren con el papel**. Si el total del asiento no es el
  del comprobante, no se postea: hay que arreglarlo en Odoo primero. Postear algo
  que no coincide con la factura es el error que después nadie encuentra.
- Lo que **no** cambió: el SdG no inventa asientos. Postea el que él mismo creó
  desde una factura que entró por el buzón.

El panel **Ver el borrador de Odoo** muestra el asiento *como está en Odoo ahora*
—líneas, cuenta, analítica, impuestos, adjuntos y totales—, no como el SdG lo
mandó. Es la diferencia entre revisar y suponer: si alguien lo tocó del otro
lado, eso es justamente lo que hay que ver antes de confirmar. El enlace para
abrirlo en Odoo sigue estando adentro del panel, porque **corregir** se hace allá.

**Es lo único del módulo reservado a `admin`.** Cargar la factura, imputarla y
dejar el borrador armado siguen siendo de `edicion` —son el trabajo de todos los
días y todo eso se corrige—; lo que se reserva es el último paso, que es el que
no se deshace. `admin` acá es el nivel del módulo (`usuario_modulos.nivel`), y
`admin_sistema` lo tiene por rol.

Quien no puede confirmar **igual ve el borrador entero**: revisar no es escribir,
y esconderlo lo dejaría sin poder chequear lo que cargó.

Ese permiso no tiene función espejo en la base, a diferencia de
`tiene_acceso_facturacion()` y `puede_editar_facturacion()`, y no es un olvido:
no hay policy que lo custodie porque el posteo no es un `insert` ni un `update`
sobre una tabla nuestra — es una llamada a Odoo. La puerta es
`puedeConfirmarEnOdoo()` y la ruta que la usa.

## Buscar escribiendo, no desplegando

Los tres catálogos de una línea son largos —378 productos, 242 cuentas contables
y 358 analíticas por empresa—, y en un desplegable eso son cientos de opciones
que hay que recorrer con la rueda. Los tres campos son buscadores: se escribe y
se filtra.

La búsqueda es por **partes sueltas**, no por prefijo: `cat 950` encuentra
`EM6 - CATERPILLAR 950 G` y `rep` encuentra `5.2.1.01.220 Repuestos`. Cada
palabra tiene que aparecer en algún lado, ni todas juntas ni en orden — nadie
recuerda el nombre exacto de una cuenta analítica. Las analíticas se muestran
agrupadas por plan (`EQUIPOS MÓVILES`, `MANTENIMIENTO`), que es como las piensa
quien imputa.

## Los embeds hay que nombrarlos

`facturas_proveedor` tiene FK a **empresas**, **proveedores** y
**compras_requerimientos** a la vez, así que abre segundos caminos de embed:
cualquier `.select("*, proveedores(nombre)")` sobre `compras_requerimientos`
falla con `PGRST201`. Las consultas afectadas ya están desambiguadas
(`proveedores!proveedor_id(nombre)`). Si aparece un PGRST201 nuevo, se arregla
**nombrando la FK**, no sacando la tabla. Ya pasó con `compras_odoo_ordenes` y
dejó el listado de Compras sin cargar.

## Cómo se verifica

```bash
npx vitest run lib/facturacion
```

Son 61 tests sobre las funciones puras, con **las facturas reales como
fixtures**: los payloads de TORRACO y de CAMINO están literales en
`qrAfip.test.ts` y `altaDeFactura.test.ts`, y los CUITs de los catálogos son los
de verdad —con guiones, como los cargó una persona, que es lo que hace que la
normalización importe—.

La búsqueda del QR en sí **no se puede probar con un fixture inventado**: se mide
contra la carpeta de facturas. El banco de pruebas no está commiteado porque
depende de una carpeta de Drive, pero es reproducible: renderizar con
`@napi-rs/canvas` (`npm i --no-save @napi-rs/canvas`) y llamar a `buscarQr` y
`buscarQrConVentanas` — las mismas funciones que corre el navegador, no una copia.

**Y después comprobarlo en el navegador**, que es lo que atrapó la pasada
fantasma de las imágenes embebidas: copiar `pdfjs-dist/build/pdf.min.mjs`,
`jsqr/dist/jsQR.js` y un par de facturas a `public/pdfjs/` —que es la única ruta
que el proxy de sesión no intercepta— y correr el pipeline desde la consola.
Acordarse de borrar las facturas de ahí después.

## Lo que queda pendiente

1. **Las que no traen QR.** 12 de 139 en septiembre son copias sin el bloque de
   ARCA (todas de ZITO Y PRIOLA, que factura seguido). Se pueden completar a mano,
   pero si ese proveedor es habitual conviene pedirle el original — o leer el
   **texto** del PDF, que en su caso está completo y legible: número, CUIT,
   receptor e importe. Sería una cuarta pasada, y es la de mejor relación entre
   trabajo y facturas rescatadas.
2. **Los QR que jsQR no decodifica** (DON ALFREDO, RUBIALES, ERGUY). Probar otro
   decodificador —zxing— antes de darlos por perdidos.
3. **Los QR que el PDF estira** (TODO RULEMAN). Se leerían corrigiendo la
   proporción del recorte, que se puede sacar de la matriz de transformación con
   que la página dibuja la imagen. Es la única forma que queda, ahora que se sabe
   que las imágenes embebidas no se pueden leer desde el navegador.
4. ~~Cerrar el círculo con Odoo~~ **hecho**: ver [El vínculo con Odoo](#el-vínculo-con-odoo).
5. **Las percepciones.** El borrador sale con el IVA y nada más. La localización
   del grupo tiene `perception_ids` en `account.move`, así que una factura con
   percepción de IIBB queda por un total menor y contabilidad la completa. El QR
   no las trae desglosadas, así que sacarlas de ahí no se puede: habría que
   leerlas del texto del PDF.
6. **El CUIT de los 146 proveedores que no lo tienen.** Odoo lo tiene en
   `res.partner.vat` para los 207 que están enlazados: es un cruce que se puede
   correr una vez y sube el reconocimiento automático del emisor.
