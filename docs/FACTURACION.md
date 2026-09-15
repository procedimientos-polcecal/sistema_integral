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

### El lector, medido: **184 de 187 facturas se leen solas (98%)**

Corrido con `scripts/banco-de-qr.mts` sobre `FACTURAS/SEPTIEMBRE 2026` entera.

| Pasada | Rescata | Por qué existe |
|---|---|---|
| **La página dibujada, subiendo la definición** (1600 → 2600 → 3600 px) | **121** | Un QR de dos centímetros en una A4 dibujada a 1600 px queda en unos 90 px, y el payload de ARCA —una matriz de 69×69 módulos— no llega a un píxel por módulo. |
| **El segundo decodificador** (ZXing en WebAssembly), sobre el lienzo que acaba de fallar | **30** | Hay QR impecables que jsQR no decodifica y ZXing sí. Cuesta decenas de milisegundos y 950 KB que se bajan **sólo** cuando jsQR falló. Ver [Había QR que "no se leían"](#había-qr-que-no-se-leían-y-el-problema-era-el-decodificador). |
| **Ventanas deslizantes**, sólo si las dos primeras fallaron y **sólo en la página 1** | **0** | Hasta 274 recortes, unos segundos. Rescataba 9 antes de que existiera el segundo decodificador; hoy no rescata ninguna, porque lo que necesitaba ventanas ya se lee a 1600. Se deja igual: cuesta sólo en las que van a fallar de todos modos. |
| **El texto del PDF**, cuando no hay QR en ninguna página | **33** | Emisores que no imprimen el bloque de ARCA — ZITO Y PRIOLA son 22. Ver [Cuando no hay QR](#cuando-no-hay-qr-la-cabecera-sale-del-texto). |

Mediana: **525 ms por factura**. El peor caso es una que **no** se lee: es lo que
tardan las ventanas en recorrer una hoja a 3000 px antes de rendirse.

**Las tres que quedan son de LOGÍSTICA VW**: escaneos sin capa de texto y sin QR
legible. Sin OCR no hay nada que sacar de ahí.

**Las 151 que se leen por QR se leen todas a 1600 px.** El escalonado a 2600 y
3600 ya no rescata a ninguna: lo que necesitaba más definición lo resuelve zxing
en el primer intento. Se deja porque cuesta sólo en las que igual iban a fallar,
y porque el próximo emisor puede imprimir el QR más chico.

Las ventanas corren sólo en la primera página, y no es una simplificación: en las
187 el QR está siempre ahí, y correrlas en tres páginas llevaba el peor caso a
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

La pasada se sacó y la conclusión que la acompañaba —que el QR de TODO RULEMAN
quedaba para carga manual— resultó ser falsa: se lee con el segundo
decodificador. Lo que sigue en pie es la lección del entorno, no el diagnóstico.

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

### Había QR que "no se leían" y el problema era el decodificador

DON ALFREDO, RUBIALES y ERGUY se ven impecables y jsQR no los decodificaba. Se
probó a 7000 px, con umbral duro y con 274 ventanas: no era resolución. Era
**jsQR**, que es un port en JavaScript y se rinde antes que la implementación
original en la corrección de errores.

El ZXing de verdad, compilado a WebAssembly, lee la página de DON ALFREDO
**entera y de una**: 53 ms a 1600 px, contra jsQR que no la lee a ninguna escala.
Comprobado en un navegador, con el lector que se commitea:
`comoSeEncontro=segundo decodificador`, cabecera de ARCA completa —CUIT
30712622802, factura A 0003-00001826 del 10/09/2026 por $559.262—.

Sobre la carpeta entera **rescata 30 de 187**: diez de REPUESTOS AGRÍCOLAS COLON,
tres de DON ALFREDO, dos de TODO RULEMAN, dos de PEDRO H. CAMINO, y AGROINGA, que
antes necesitaba las 274 ventanas.

**No reemplaza a jsQR, corre después.** jsQR resuelve 121 de 187 sin bajar un byte
de más; el wasm son 950 KB y se baja sólo cuando jsQR falló. Y va **antes** de las
ventanas deslizantes: cuesta decenas de milisegundos y rescata en el primer
intento lo que las ventanas tardarían un minuto en no encontrar.

#### Dos cosas que este doc decía y el banco desmintió

- **El QR de TODO RULEMAN sí se lee.** Estaba dado por perdido —"el PDF lo
  estira", "no llega a dos píxeles por módulo"— y las dos facturas de septiembre
  se leen a 1600 px. El error fue medir sobre un **PNG de 1400 px** en vez del
  PDF: reescalar un derivado no agrega la información que el original tiene.
- **RUBIALES no era un problema de decodificador.** Sus facturas **no traen QR**:
  se abrió la página y se miró. Salen por el lector de texto, como ZITO Y PRIOLA.
  Estaban listadas como "se ven impecables y jsQR no las lee", que era falso.

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

## Cuando no hay QR, la cabecera sale del texto

Hay emisores que no imprimen el bloque de ARCA. El caso grande es **ZITO Y
PRIOLA: 280 facturas en 2026**, el que más factura del grupo, y sus PDF son
"copia del original". Hoy esas se tipean enteras. Su capa de texto, en cambio,
está completa — la misma que ya se usa para el detalle.

**El QR manda siempre.** El texto se lee **sólo si no se encontró QR**: uno es un
dato firmado por ARCA, el otro un diseño impreso que cada sistema arma como
quiere. No compiten.

### Lo único que podía salir mal y no notarse

Una factura trae dos CUIT —emisor y receptor— y confundirlos pondría la factura a
nombre del grupo. **No se resuelve por posición en la hoja**, porque cada diseño
la pone donde quiere, sino por un dato que ya tenemos: el CUIT que es de una de
las dos empresas del grupo es el **receptor**; el otro es el **emisor**.
Determinístico, no heurístico. Hay un test que lee las filas al revés y saca lo
mismo.

### Las otras trampas, una por campo

- **El número no es un CUIT.** `20-16581164-0` tiene la forma de un par
  `punto de venta - número`; el patrón exige cuatro o cinco dígitos del lado
  izquierdo, que es lo que los separa.
- **La fecha de emisión no es la de vencimiento** ni la de inicio de actividades:
  una factura trae tres o cuatro fechas. Se descartan las filas que dicen `Vto`,
  `Venc` o `Inicio`. Y se lee **d/m**, que ya dio vuelta 885 fechas en Compras
  cuando se leyó al revés.
- **Entre "fecha" y el número puede haber palabras.** `FECHA : 1/9/2026` y
  `A Fecha de Emisión: 02/09/2026 09:14:16` son lo mismo escrito por dos
  emisores. Exigir el número pegado a la palabra dejaba afuera a ZITO Y PRIOLA,
  BER IMPORT y COOPELECTRIC — 26 de 187. La ventana es corta y se prefieren las
  filas que dicen "emisión", para que la tolerancia no enganche otra fecha.
- **El total no es el subtotal**: de las filas que dicen `TOTAL` y no `SUBTOTAL`
  se toma el número más grande.
- **Y el total puede estar en la fila de abajo.** Cuando la fila que dice TOTAL
  no trae ningún importe es un encabezado de columna: ZITO Y PRIOLA escribe
  `… Tasa Vial Total` y recién después los ocho números, y ERGUY escribe
  literalmente `TOTAL:` y el importe abajo.
- **El tipo sale del código impreso** (`Cod. 01`), que es el número de ARCA sin
  intermediarios; si no está, se arma con el documento y la letra.

### Los números se escriben de tres maneras, y confundirlas no falla: miente

Las tres están en la misma carpeta de un mes:

| Cómo se escribe | Quién | Qué pasaba antes |
|---|---|---|
| `1.774.706,10` | la mayoría | bien |
| `1,699,556.67` | ZITO Y PRIOLA, COOPELECTRIC | de `41,269,391.77` salía **177** |
| `1 586 745.60` | AGROINGA | salía **745,60**, mil veces menos |

La regla que las distingue: **manda el último separador**. Si lo siguen
exactamente dos dígitos y ahí termina, es el decimal y todo lo demás es
agrupamiento; si no, no hay decimales. Los espacios —incluido el duro, que es
invisible— cuentan como agrupamiento sólo en grupos de tres dígitos exactos.

Ninguno de los dos casos **fallaba**: los dos devolvían un número plausible y
equivocado, que es la clase de error que nadie mira dos veces. Los encontró el
control del banco contra el QR, no un test.

### Cómo se puede medir esto, que es lo interesante

**Cada factura que sí trae QR es un banco de pruebas.** Se lee el texto, se
compara contra el QR —que es la verdad— y ahí se ve si acierta. Eso ya no es una
idea: es `scripts/banco-de-qr.mts --controlar`, y corrido sobre septiembre da
**151 facturas con QR y con texto, 129 en las que el texto coincide con ARCA en
todo lo que pudo leer**.

De las 22 que no coinciden, **11 son del emisor y no del lector** — ver
[Hay QR que vienen con el importe en centavos](#hay-qr-que-vienen-con-el-importe-en-centavos).
Las otras 11 son el lector de texto equivocándose en facturas **que sí tienen
QR**, así que en producción no las toca: el texto se lee sólo cuando no hay QR.

Todo lo que no se encuentra queda vacío y lo completa una persona: el buzón nunca
se bloquea y nunca inventa un número.

`identificado_por` distingue ahora **tres** orígenes: `qr`, `texto` y `a mano`.
No son la misma calidad de dato, y la columna existe justamente para poder
preguntarlo después.

## Hay QR que vienen con el importe en centavos

**Es lo más grave que encontró el banco, y no es un problema del sistema: es de
quien emite.**

REPUESTOS AGRÍCOLAS COLON y EL MANU MATERIALES firman el QR con el importe **sin
el punto decimal**. La factura 0004-00029315 está impresa `Total $ 27.830.00` y
su QR dice `"importe":2783000`. El payload está además corrupto —trae tabuladores
en el medio del JSON, `"nroCmp":29315			,`— así que los dos vienen del mismo
sistema de facturación mal hecho.

Son **11 de las 187 de septiembre (6%)**, todas exactamente ×100:

| Emisor | Cuántas |
|---|---|
| REPUESTOS AGRÍCOLAS COLON | 10 |
| EL MANU MATERIALES | 1 |

Eso hoy entra al borrador de Odoo **cien veces más grande**, y el único control
que había era que alguien mirara el número. El QR es la fuente —esa regla no
cambia— pero cuando el PDF tiene capa de texto se puede contrastar, que es
exactamente lo que hace el banco. Las otras seis diferencias de importe que
aparecen en ese control (ratios 1,21, 1,40, 4,88, 0,0007) son el lector de texto
equivocándose, no el QR.

## A quién se le facturó: el emisor sale de Odoo, no del padrón

**Es lo que destrabó más de la mitad de las facturas.** El buzón resolvía el
emisor contra el padrón de proveedores del SdG, y sin proveedor no se podía crear
el borrador. Medido sobre las **2.776 facturas de proveedor de 2026**: en **1.558
(56%)** el CUIT del emisor no está en ese padrón.

No es que falte el dato — **Odoo tiene el CUIT del 100% de esos partners**. Es que
el padrón del SdG tiene 293 proveedores activos y Odoo 587 con CUIT, y los que
más facturan nunca pasaron por un requerimiento de Compras, que es de donde salió
el padrón: ZITO Y PRIOLA (280 facturas), RUBIALES (98), BAX (66), SANDOVAL (49),
la cooperativa eléctrica (49). Transportistas y servicios.

Así que el emisor se resuelve **contra `res.partner` por CUIT**, que además es lo
que el asiento necesita de verdad. El proveedor del SdG sigue existiendo y sigue
sirviendo —vincula la factura a un requerimiento— pero **dejó de ser obligatorio**.

**No se importan los proveedores de Odoo al padrón**, y es deliberado:
`proveedores` es un catálogo del núcleo que comparten seis módulos, y meterle 300
transportistas que sólo le sirven a Facturación ensuciaría los selectores de
Compras, Mantenimiento e Inventario. El emisor de una factura y el proveedor al
que se le compra se parecen y no son lo mismo.

### Cómo se elige entre varios

Sobre los 1.555 partners con CUIT hay 1.341 claves (CUIT, empresa) y 142 con más
de un registro. Tres filtros, en orden, y cada uno sale de mirar los duplicados
reales:

1. **Fuera los contactos hijos** (`parent_id`): son direcciones de entrega de la
   misma empresa. AXIL S.R.L. tiene cuatro.
2. **Fuera los archivados.**
3. **La empresa manda**: en Odoo cada registro pertenece a una, y facturarle a
   POLCECAL con el partner de POLYSAN es un asiento en la contabilidad
   equivocada. Un partner sin empresa es compartido y sirve para las dos, pero
   sólo si no hay uno propio.

Con eso quedaban 9 CUIT ambiguos. **Todos son el mismo caso: un registro que se
usa y otro que no**, o mal escrito — `IPERACTIVE S.A.` con 37 usos contra
`Ipertactive S.A.` con cero, `R&C MAQUINADOS SRL` contra
`R&C MAQUINADOS SRL (No usar)`. Odoo lleva esa cuenta en `supplier_rank`, así que
el desempate es por uso y no por parecido, y **se exige que el primero triplique
al segundo**: así no se elige entre dos registros que se usan de verdad.

**Resultado medido: de reconocer el 44% de las facturas a reconocer el 100%**
(2.772 de 2.776). Las 4 que quedan son un CUIT que existe en Odoo pero en la otra
empresa, que es una negativa correcta: hay que darlo de alta ahí, o la factura
está asignada a la empresa equivocada.

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

### La cuenta contable se propone desde lo que ya se hizo

La cuenta se elegía a mano en cada línea, siempre. Y había **11.013 líneas de
factura de proveedor en Odoo** diciendo a qué cuenta fue cada compra: el dato
estaba sin usar.

Los umbrales salen de un **backtest**, no de una corazonada: se aprendió de las
8.700 líneas más viejas y se predijeron las 2.200 más nuevas, en cascada
proveedor+producto y, si no alcanza, proveedor solo.

| Confianza mínima | Propone en | Acierta | Resuelve del total |
|---|---|---|---|
| sin umbral | 94% | 76,4% | 72% |
| 0,7 | 69% | 87,2% | 60% |
| **0,8** | **65%** | **89,3%** | **58%** |
| 0,9 | 57% | 90,4% | 51% |

Se eligió **0,8**: subir a 0,9 gana un punto de acierto y pierde ocho de
cobertura. Y se piden **dos antecedentes**, porque una sola compra anterior no es
una costumbre.

**Propone, no completa.** Un 89% es mucho para ahorrar trabajo y poco para
decidir solo: una de cada diez iría a la cuenta equivocada, y un gasto mal
imputado no se nota nunca. Así que la sugerencia aparece **con su antecedente a
la vista** —"257 de 267 veces fue a Fletes y Acarreos, según este proveedor"— y
**no se guarda hasta que alguien la aplica**, de a una o todas juntas. Todo lo que
queda en la base lo eligió una persona, y por eso no hizo falta una columna que
distinga lo sugerido de lo elegido.

El historial se consulta **en vivo y por factura**, con un `read_group` que Odoo
resuelve del lado del servidor: 12 combinaciones y 220 ms para el proveedor con
más historia de la instancia. Sin tabla local que mantener — el historial cambia
cada vez que contabilidad imputa algo, y una copia vieja propondría lo que el
grupo dejó de hacer.

Y se calla cuando no sabe. ALMENTA tiene 5 líneas históricas repartidas entre dos
cuentas: 3 de 5 es 60%, por debajo del umbral, así que no propone nada. Es el
comportamiento correcto, y conviene esperarlo en los proveedores nuevos.

**La analítica no se propone**, y no es un olvido: el mismo backtest da 38% de
cobertura al 78% de acierto. Ese rango es justo donde uno aprende a apretar "sí"
sin mirar.

### La analítica: primero lo que dijo quien pidió, después la costumbre

Dos fuentes en cascada, y **no valen lo mismo**.

**Lo que contestó quien pidió, que es el dato y no una probabilidad.** Desde el
15/09/2026 el formulario de Google pregunta **EQUIPO QUE SOLICITA**, y el
desplegable usa el vocabulario del grupo: `PO-A1-01 - ACARREADOR DE PLACAS`. Ese
texto **es**, palabra por palabra, el nombre de la cuenta analítica de Odoo. Así
que la imputación deja de deducirse: la dice la persona que pidió el repuesto.

Medido con el código real sobre las 255 opciones del desplegable: **241 resuelven
a una única cuenta analítica en cada empresa, y ninguna queda ambigua.** Las 14
que no: ocho equipos que están en el desplegable y no en Odoo (`PO-C1-10`,
`PO-C1-11`, los cuatro `PY-A2-1x`, dos molinos a martillos) y seis opciones que no
tienen cuenta propia (MECÁNICO, CONSTRUCTORA, CAPATACES, LABORATORIO, LUBRICADOR,
LA ALCANCIA).

Y cubre lo que el equipo no podía: **PAÑOL, GALPON 1, TALLER ELÉCTRICO,
CONTRATISTA** no son máquinas y no existen en el catálogo de equipos, pero sí son
cuentas analíticas. Por el nombre llegan; por el equipo no llegarían nunca.

**El equipo de la ubicación, como respaldo.** Es el camino anterior y queda para
los RI cargados antes de que el formulario preguntara. El enlace es por
**código**: el grupo le puso `PO-A1-01`, `EM6` a cada equipo y ese mismo código
está escrito en el nombre de la analítica. Medido sobre los 239 equipos activos,
**235 resuelven en Polcecal y 236 en Polysan**; los que no son `C1`, `C2` y `C3`
—en Odoo conviven un `C1` del plan CANTERA y un `C1 - COMPRESOR 1` del plan
COMPRESORES, dos cosas distintas que empiezan igual— y `PO-C1-10`, que no tiene
analítica en Polcecal.

Un borde que costó: **`EM1` no puede matchear `EM10`**. Se exige que el código
termine ahí. Sin eso, el equipo EM1 se llevaba dieciséis analíticas por delante.

**Lo que este proveedor repartió antes, cuando no hay requerimiento.** Acierta
mucho menos: en el backtest, 38% de cobertura al 78%. A qué equipo fue un repuesto
depende de qué se rompió esa semana, no del proveedor. Se muestra con el
antecedente y se aplica a mano, nunca sola.

### De dónde sale el equipo, y por qué no de la columna del master

La planilla master **también** tiene una columna EQUIPO, y **no se puede leer**.
La arma un `FILTER(FLATTEN(...); ... <> "")` sobre las dieciséis columnas de la
hoja de respuestas —la pregunta está repetida una vez por rama del formulario—, y
ese filtro tira los blancos y aprieta los valores hacia arriba. En cuanto un RI
tenga equipo y el de abajo no, la fila N de esa columna deja de corresponderse
con el RI de la fila N: cada compra quedaría imputada a la máquina de otro, sin
que nada avise. Es el enlace equivocado que no se nota nunca.

Por eso el SdG lee **la hoja de respuestas del formulario** y une **por número de
RI**, que es lo único que identifica la fila. Queda pendiente del lado de la
planilla: mientras esa fórmula siga así, lo que ven en la columna EQUIPO del
master los que no entran al sistema va a estar corrido.

### Qué se guarda, y qué queda en null

Las mismas dos columnas que ya usa la ubicación, por la misma razón:
`equipo_raw` es lo que contestó la persona, tal cual, y es lo que Facturación usa
para buscar la analítica; `equipo_id` es el enlace al catálogo del núcleo y sólo
se completa cuando el texto identifica un equipo **sin ambigüedad**. Las opciones
que no son máquinas quedan con `equipo_id` en null a propósito: enlazar al que se
le parece es peor que dejar en null.

La precedencia entre lo declarado y lo que dice la ubicación no se decide acá:
vive en `lib/compras/equipoDelPedido.ts`, para que no esté distinta en cada
consulta que la necesita. Lo que importa para la imputación es su segunda mitad:
**un equipo declarado que no se pudo enlazar no cae de vuelta en la ubicación.**
Si alguien contestó "LA ALCANCIA" —que no tiene analítica— no se propone la del
lugar donde se entrega: eso sería mostrar un equipo que nadie dijo. Se cae al
historial del proveedor, que al menos se muestra como lo que es.

La vía del requerimiento es **certera**, y la del historial es ancha y floja. La
pantalla distingue cuál es cuál: la del requerimiento se muestra en verde, la del
historial con su "12 de 18 veces".

Un ejemplo real de por qué el umbral importa: RUBIALES repartió sus últimas
líneas 122 veces a una analítica, 110 a otra y 19 a una tercera. Eso es 48%, muy
por debajo del 0,8 — así que **no propone nada**, que es lo correcto.

### El borrador se actualiza, y confirmar controla que esté al día

**Faltaba, y costó una factura mal contabilizada.** El circuito real es cargar la
factura, crear el borrador para verlo, y **recién ahí** imputar cada línea con su
cuenta y su distribución analítica. Con sólo "crear", esas correcciones quedaban
guardadas en el SdG y no llegaban nunca al asiento: el borrador seguía siendo el
de antes de imputar, y confirmarlo posteaba eso — sin cuenta, sin analítica y ya
inmutable.

**Actualizar el borrador** lo reescribe con lo que dice el sistema ahora. Manda
los mismos `vals` que un borrador nuevo —salen de la misma función, que es lo que
garantiza que los dos queden iguales— y reemplaza las líneas enteras con
`(5, 0, 0)`: una línea que se borró del detalle tiene que desaparecer del asiento,
y emparejar línea por línea entre dos sistemas es justo donde se cuelan los
duplicados. Sólo sobre un borrador, y el PDF no se vuelve a adjuntar.

Y **confirmar se niega si el asiento no es lo que dice el SdG**. El control del
total no alcanzaba: cambiar la cuenta o la analítica de una línea no mueve el
total ni un centavo, que es exactamente por lo que se perdió sin que nada avisara.
Ahora se compara línea por línea y el error dice cuál está mal y en qué
(`diferenciasDeImputacion`, que es pura y está testeada).

Un dato que hubo que medir antes de culpar al código: **Odoo sí respeta una
cuenta y una `analytic_distribution` explícitas**, con producto y sin producto,
tanto al crear como al escribir. No las pisa con las del proveedor. El problema
nunca fue Odoo.

### Qué hace cada cosa

| | |
|---|---|
| **Crear el borrador en Odoo** | Crea el `account.move` en borrador —postable— y deja la factura en `informada`, con `odoo_conciliado_por = push` |
| **Actualizar con lo del sistema** | Reescribe las líneas del borrador con la imputación de ahora. Nivel de edición |
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

La búsqueda del QR en sí **no se puede probar con un fixture inventado**: lo que
decide si una factura se lee no es la lógica sino cómo la imprimió el emisor. Se
mide con el banco, que **sí está commiteado** —`scripts/banco-de-qr.mts`— aunque
la carpeta que necesita no:

```bash
npm i --no-save @napi-rs/canvas
npx tsx scripts/banco-de-qr.mts "G:/…/FACTURAS/SEPTIEMBRE 2026"
```

Corre `buscarQr`, `buscarQrConZxing`, `buscarQrConVentanas` y
`leerCabeceraDelTexto` **importadas de `lib/`**, no copiadas. Lo único distinto es
de dónde salen los píxeles (`@napi-rs/canvas`) y de dónde sale el wasm de ZXing
(del disco). Tarda unos 20 minutos sobre 187 facturas.

**Dos trampas del banco, las dos ya pisadas:**

- **Hay que pasarle `wasmUrl` a pdf.js.** Desde la 6 decodifica JBIG2 y JPEG2000
  con WebAssembly, y sin esa ruta **una factura escaneada se dibuja sin su
  imagen**: el banco la cuenta como perdida y en el navegador se lee perfecto.
  Invalidó una corrida entera —38 avisos sobre 10 imágenes— y dio 149 donde eran
  151. En el navegador pdf.js resuelve su propio wasm y no hace falta.
- **Medir en Node no alcanza.** Es lo que atrapó la pasada fantasma de las
  imágenes embebidas. Después del banco hay que comprobarlo en un navegador de
  verdad: no hay `middleware.ts` —la autenticación vive en el layout de
  `(app)`—, así que una ruta temporal fuera de ese grupo, más la factura servida
  desde `public/pdfjs/`, alcanza para correr el lector real. Acordarse de borrar
  las dos cosas después.

## Lo que queda pendiente

1. ~~Las que no traen QR~~ **hecho**: ver
   [Cuando no hay QR](#cuando-no-hay-qr-la-cabecera-sale-del-texto).
2. ~~Los QR que jsQR no decodifica~~ **hecho**: era el decodificador, no la
   imagen. Ver [Había QR que "no se leían"](#había-qr-que-no-se-leían-y-el-problema-era-el-decodificador).
3. ~~El QR de TODO RULEMAN~~ **no era un problema**: se lee. Estaba dado por
   perdido sobre un PNG, no sobre el PDF.
4. ~~Las 28 que fallaban por patrón de texto~~ **hecho**: ZITO Y PRIOLA (22),
   ERGUY (2), BER IMPORT (2) y COOPELECTRIC (2) pasaron a leerse. De 156 a 184
   sobre 187. Ver [Cuando no hay QR](#cuando-no-hay-qr-la-cabecera-sale-del-texto).

### Lo que queda, medido

- **3 de LOGÍSTICA VW.** Escaneos sin capa de texto y sin QR legible. Sin OCR no
  hay nada que sacar, y son el 1,6% de la carpeta.
- **Los 11 QR con el importe en centavos.** El lector los carga con un total 100
  veces mayor — ver [la sección](#hay-qr-que-vienen-con-el-importe-en-centavos).
  El contraste contra lo impreso ya está medido y detecta exactamente esos 11,
  sin un solo falso positivo sobre 151; falta llevarlo del banco a la pantalla.
- **11 diferencias del lector de texto** contra el QR, en facturas que sí traen
  QR. Hoy no molestan —el texto sólo se usa cuando no hay QR— pero son la lista
  de lo que el lector todavía lee mal: dos tomaron el neto por el total
  (FUNDICIÓN ELÉCTRICA NAVARRO), dos el número de otra columna (CANOBE,
  FERRETERÍA MARFRA), dos la fecha corrida un día (SIS, PERERA).
4. ~~Cerrar el círculo con Odoo~~ **hecho**: ver [El vínculo con Odoo](#el-vínculo-con-odoo).
5. **Las percepciones.** El borrador sale con el IVA y nada más. La localización
   del grupo tiene `perception_ids` en `account.move`, así que una factura con
   percepción de IIBB queda por un total menor y contabilidad la completa. El QR
   no las trae desglosadas, así que sacarlas de ahí no se puede: habría que
   leerlas del texto del PDF.
6. **El CUIT de los 146 proveedores que no lo tienen.** Odoo lo tiene en
   `res.partner.vat` para los 207 que están enlazados: es un cruce que se puede
   correr una vez y sube el reconocimiento automático del emisor.
7. **La columna EQUIPO del master está corrida**, y eso es de la planilla, no del
   sistema — ver [De dónde sale el equipo](#de-dónde-sale-el-equipo-y-por-qué-no-de-la-columna-del-master).
   El SdG no la usa, así que no le afecta; lo que queda mal es lo que ven en la
   planilla los que no entran al sistema. Se arregla del lado de Sheets, uniendo
   por N° de RI en vez de apretar los blancos con `FILTER`.
8. **Los RI cargados desde el sistema no declaran equipo.** El alta escribe en la
   pestaña `Altas del sistema`, que no tiene esa columna, y la pregunta sólo
   existe en el formulario de Google. Mientras siga así, esos pedidos caen en la
   vía del historial. Se resuelve cuando el alta del sistema pregunte lo mismo.
9. **Los 1.970 RI que ya están cargados no tienen equipo**, porque la pregunta es
   nueva y nadie la contestó todavía. La sincronización lo va a ir llenando a
   medida que entren pedidos nuevos; los viejos se quedan con la vía de la
   ubicación (206) y con la del historial.
