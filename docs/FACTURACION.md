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

**Lo que el buzón no hace: postear en Odoo.** El asiento lo confirma una persona:
un `account.move` posteado es inmutable y la numeración fiscal la asigna Odoo. Es
la regla de todo el enlace: el SdG propone, Odoo confirma. Ver
[ODOO-INTEGRACION.md](ODOO-INTEGRACION.md).

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

### Odoo no tiene la localización argentina, y eso decide todo

Medido el 11/09/2026 contra la instancia: **no existe `l10n_latam.document.type`
ni ningún campo para el tipo de comprobante.** Para Odoo, una factura de
proveedor del grupo es un documento genérico. Consecuencias directas:

- El `name` es `BILL/2026/09/0004`, una **secuencia interna** que no tiene nada
  que ver con el papel — y mientras está en borrador es `/`, porque Odoo numera
  al postear. Nunca sirve para reconocer un comprobante.
- El número fiscal vive en **`ref`**, escrito a mano: `FC A 00008-00003715`,
  `FC   A 00008-00003738`, `FC A - 00008-00003683`. Y está en apenas **1.554 de
  6.423 facturas (24%)**: de las otras 4.869 no hay registro de qué comprobante
  son.

Por eso el borrador que crea el SdG **siempre** escribe la referencia, con la
sigla y el formato que ya usa administración (punto de venta en cinco dígitos:
1.745 de 1.959 números cargados van así). Además de servir para reconocerla
después, completa un dato que hoy se pierde en tres de cada cuatro facturas.

### El IVA sale de la letra, no de una suposición

El QR trae el importe **con IVA** y una línea de Odoo lleva el neto. Cuál es cuál
lo decide la letra del comprobante, y eso está medido sobre los 1.143
comprobantes con referencia cargada:

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

### La conciliación pide el número **y** el CUIT

No alcanza con el importe. El trío (proveedor, fecha, importe) se repite en el
**1,4%** de las facturas de 2026, y sin la fecha en el **14,5%**. Un 1,4% de
enlaces mudos y equivocados es justo lo que este sistema no hace: una factura mal
conciliada aparece como contabilizada y nadie vuelve a mirarla.

Entonces se afirma el vínculo sólo cuando el CUIT del emisor es el del proveedor
del asiento **y** el par (punto de venta, número) aparece en su referencia. Una
factura de Odoo puede quedar vinculada a **varias** del buzón, y eso no es un
error: 321 de las 1.147 referencias agrupan varios comprobantes en un asiento.

**Probado contra los datos reales**: de 400 facturas de Odoo con referencia, 210
tienen un solo número; la conciliación reconoció **189, se equivocó en 0** y dejó
**21 ambiguas**. Las ambiguas enseñaron algo que no se deducía: administración
**repite la misma referencia en asientos distintos** — `FC A 00008-00003291`
figura en seis facturas de RUBIALES, con seis importes y seis fechas. La
referencia, para ellos, es una nota; no una identidad. Ahí no se elige: se le
muestran los candidatos a una persona.

### Qué hace cada cosa

| | |
|---|---|
| **Crear el borrador en Odoo** | Crea el `account.move` en borrador y deja la factura en `informada`, con `odoo_conciliado_por = push` |
| **Buscar en Odoo** | Trae los candidatos de ese proveedor, con el motivo por el que están en la lista, para elegir a mano |
| **Sincronizar con Odoo** | Relee los vínculos que hay y busca los que faltan. Lo corre también el cron `/api/cron/facturacion-sync`, a las 9:30 |
| **Ya está en Odoo** | Sigue existiendo: es la marca manual para lo que ninguna regla puede afirmar |

`odoo_conciliado_por` distingue `push` de `numero` y de `a mano` por el mismo
motivo que `identificado_por` distingue el QR de lo tipeado: si mañana una
factura aparece contabilizada y no debía, la primera pregunta es si lo dedujo el
sistema o lo decidió alguien.

Una línea de `account.move` **no necesita producto**, a diferencia de
`purchase.order.line` —que lo exige por una restricción SQL—: Odoo le pone la
cuenta de gasto que corresponde al proveedor. Comprobado creando facturas de
verdad en staging y borrándolas (un borrador se borra directo; cancelar primero
es cosa de las órdenes de compra).

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
5. **Las referencias repetidas de Odoo.** El 10% de los asientos con referencia
   no se pueden conciliar solos porque el mismo número está escrito en varios.
   Se resuelven a mano con los candidatos, pero si el volumen molesta, la
   conversación es con administración: la referencia es el único lugar donde vive
   el número del comprobante y hoy se usa como nota.
6. **El CUIT de los 146 proveedores que no lo tienen.** Odoo lo tiene en
   `res.partner.vat` para los 207 que están enlazados: es un cruce que se puede
   correr una vez y sube el reconocimiento automático del emisor.
