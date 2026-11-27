# Módulo Compras

Reemplaza la planilla **PEDIDOS DE COMPRA** por un circuito con usuarios,
permisos e historial. Portado desde `procedimientos-polcecal/COMPRAS`, que era
una app suelta, y reapuntado al núcleo del SdG.

## El circuito que modela

La planilla tiene dos capas, y el módulo conserva esa separación porque son dos
decisiones de personas distintas:

1. **Alta** — un área carga un Requerimiento Interno (RI): qué necesita, cuánto,
   dónde y para cuándo. Hoja `Requerimientos internos`.
2. **Aprobación** — gerencia aprueba o deniega. Columnas `PRIORIDAD`, `Empresa`
   y `Estado` del master.

   La prioridad y quién paga **las propone quien pide** cuando el pedido entra
   por el sistema, y gerencia las confirma o las cambia al aprobar. Desde el
   09/09/2026 el sistema las escribe en el master **en cada exportación** y no
   sólo al aprobar: si las escribiera al aprobar, un pedido cargado acá se vería
   en la planilla sin prioridad hasta que alguien lo apruebe, y ése es
   justamente el dato que sirve para decidir el orden.

   Esos dos campos no los fija quien pide: el área sugiere, gerencia decide. Es
   la regla real del circuito, y es lo que explica que el 68% del histórico esté
   marcado `URGENTE` — cuando la urgencia la declara el que pide, deja de
   distinguir.

   **Nacen sin valor y se muestran como «—».** No hay `NORMAL` ni `Ambas` por
   defecto: un valor por defecto es una decisión disfrazada de dato, y encima una
   que después nadie revisa porque el campo ya "tiene algo". Sin definirlos no se
   puede aprobar.

   Para que `Ambas` siga siendo expresable, quién paga tiene tres estados:
   `empresa_id` apunta a una empresa, o `paga_ambas` marca las dos, o ninguno de
   los dos y está sin definir.
3. **Compra** — el circuito propio de Compras, en la hoja `RI <ÁREA>`:

   | Estado | Quién actúa | Qué deja cargado |
   |---|---|---|
   | Sin iniciar | Compras | — |
   | En comparativa | Compras | carga los presupuestos y elige la planilla |
   | Para comprar | **NICO o MAXI** | eligen un presupuesto: elegir **es** aprobar |
   | Compra aprobada | Compras | quién la aprobó y cuándo |
   | Pedido | — | fecha, proveedor, costo + IVA y envío, y **para cuándo se espera que llegue** |

   En la planilla el estado dice a quién le toca: `PARA COMPRAR (NICO)`. Ese
   nombre no es decorativo — **sólo esa persona puede aprobar esa compra**. Si
   hay que cambiarla, Compras reasigna.

   Cada paso deja cargado lo suyo y la app no deja avanzar sin eso: llegar a
   `PEDIDO` sin proveedor ni costo es llegar a un pedido que después nadie puede
   seguir.

   `RECIBIDO` existe en la app pero **no en el desplegable de la planilla**, así
   que no se escribe. Se define al desarrollar el seguimiento de compra.

### La fecha estimada se pide al registrar el pedido (30/10/2026)

Vivía sólo en el formulario de recepción, o sea que se cargaba **cuando la cosa
ya había llegado**, que es justo cuando esa fecha no le sirve a nadie. Medido el
30/10/2026: de los **356 RI que estaban en PEDIDO** —los que alguien está
esperando— **7** tenían fecha estimada; de las 1.550 cargadas, casi todas eran
de RI ya recibidos. Quien pregunta «¿cuándo llega?» es el que no puede cerrar su
OT sin el repuesto, y la respuesta tiene que existir mientras todavía es una
espera.

Ahora la pide el modal **«Registrar el pedido»**, junto al proveedor y al costo,
y se exige para avanzar: es la misma regla de siempre —cada paso deja cargado lo
suyo—. Del formulario de recepción salió el campo editable, pero **la fecha se
sigue mostrando ahí**, al lado de «¿Cumplió Compras?»: es contra ella que se
juzga ese cumplimiento, y sin verla el juicio se da a ciegas. Corregirla —un
proveedor que avisa que se atrasa— se hace en **Gestión de compra**, en la ficha
del RI.

Tres cosas que no se deducen del código:

- **La exigencia es al *entrar* a PEDIDO, no en cada guardado que lo nombre.**
  No está en la tabla `FALTA` de la ruta por eso: el formulario de recepción
  manda `estado_compra: "PEDIDO"` en cada guardado sin fecha de recepción, así
  que metida ahí habría dejado sin poder cargarse los **349** RI que ya estaban
  en PEDIDO sin fecha. La condición es la misma con la que se dispara la orden
  de Odoo, y vive en [lib/compras/registrarElPedido.ts](../lib/compras/registrarElPedido.ts).
- **Volver de `EN_ESPERA` no la exige**, igual que no exige el proveedor ni el
  costo: volver de la espera es retomar donde estaba, y exigirle algo deja
  atrapado adentro al pedido que se frenó justamente porque le faltaba.
- **El modal se abre mucho menos de lo que parece.** Medido el 30/10/2026: de
  las **503 transiciones a PEDIDO** registradas, **5** tienen autor, y en los
  últimos 60 días fueron **299 y 1**. `fecha_pedido` está en null en los 2.220
  RI. El estado llega a PEDIDO por la **sincronización con la planilla**, casi
  siempre saltando `SIN_INICIAR → PEDIDO` de una — el mismo motivo por el que la
  orden de Odoo se mudó al importador el 02/10. Mientras mande la planilla, la
  mayoría de los pedidos va a seguir sin fecha estimada: esto la pide donde una
  persona la puede contestar, no en todos los casos. **Es el riesgo asumido y
  está decidido a pedido.**

### Y la orden de compra en Odoo se ofrece en el mismo modal

Ya se creaba sola al entrar a PEDIDO, **y en silencio**: el listado tiraba a la
basura el `orden_odoo` y el `aviso_odoo` que devuelve la ruta, así que ni el
número que contabilidad necesita ni el fallo llegaban a nadie — sólo se veían
entrando a la ficha de ese RI, y había **12 con `odoo_pendiente`**.

Ahora el modal lo dice, con un casillero **tildado por defecto** (que es lo que
el sistema venía haciendo). Lo nuevo no es crearla: es poder decir que no, y
enterarse de cómo salió. Sólo un `false` explícito la saltea — cualquier llamada
que no mande `crear_orden_odoo` la crea, como siempre. El casillero no aparece
si no hay credenciales de Odoo: ofrecer algo que no se va a hacer es peor que no
ofrecerlo.

Por eso cada requerimiento lleva **dos estados independientes**:

| Campo | Valores |
|---|---|
| `estado_aprobacion` | `PENDIENTE` · `EN_REVISION` · `APROBADA` · `DENEGADA` |
| `estado_compra` | `SIN_INICIAR` · `PARA_COMPRAR` · `EN_COMPARATIVA` · `PEDIDO` · `RECIBIDO` · `DENEGADO` |

Las hojas por área (`RI MANTENIMIENTO`, `RI ALMACÉN`, …) **no son entidades
distintas**: las 1764 filas cruzan todas contra el master, así que son vistas
filtradas. Acá son un filtro por área, no tablas separadas.

## Permisos

Los tres niveles del núcleo (`usuario_modulos.nivel`) se mapean así:

| Nivel | Puede |
|---|---|
| `lectura` | Consultar todo el circuito |
| `edicion` | Cargar comparativas y presupuestos, gestionar proveedor, costos y OC, asignar a quién le toca aprobar, y avanzar los estados del circuito |
| `admin` | Lo mismo, y además administrar el módulo: quiénes están en la lista de aprobadores |

Aprobar es más restrictivo que comprar a propósito: es una decisión sobre el
gasto, no una tarea operativa.

**Y es el único permiso donde ser administrador del sistema no alcanza.** La
planilla restringe la columna de aprobación del master a una lista de cuentas
(protección "APROBACIÓN DE GERENCIA"), y la app espeja esa misma lista: hace
falta el módulo Compras con nivel `admin`, sin atajos. Si un admin pudiera
aprobar sin estar en la lista, los dos lados dirían cosas distintas sobre quién
aprueba, justo en el control que más importa.

La lista vigente se ve en `/compras/configuracion`, para compararla con la de la
planilla. Las dos se mantienen a mano: no hay forma de leer los editores de una
protección de Google desde afuera de ella.

**Y quién lee esa lista no es un detalle: hasta el 27/11/2026 estuvo rota para
todos menos para los `admin_sistema`, en silencio.** Las tres listas de
Configuración —aprobadores de compra, aprobadores de OS y consultados— y el
desplegable «A quien le toca aprobarla» del diálogo «Comparativa lista» salen de
funciones que traen a la gente **embebiendo `usuarios(...)`** desde su tabla de
pertenencia. La tabla de pertenencia es abierta, pero `usuarios` está cerrada con
`usuarios_select_self` (migración 002): `using (id = auth.uid() or es_admin())`,
nunca ensanchada, y desde la `20260910091647` `es_admin()` es **sólo
`admin_sistema`**. O sea que a cualquier otro el embed le devolvía
`usuarios: null` en todas las filas menos la suya —**sin error**— y el `.filter()`
de cada función las descartaba como si esas personas no existieran.

Lo que eso producía, medido: **Facundo Ortiz, el encargado de compras, es
`encargado` y no `admin_sistema`**, así que al declarar una comparativa lista el
desplegable le ofrecía **una sola opción, él mismo**, y no podía asignarle la
compra ni a Maxi ni a Nico. En Configuración veía las tres listas con una sola
persona, y «sumar aprobador» le ofrecía un solo nombre. Nico y Bernardo son
`admin_sistema` y veían las cuatro: por eso pasó meses sin que nadie lo notara.
Lo reportó quien lo sufría, como un pedido de función —«que igualmente pueda
decidir si aprueba maxi o nico»— y no como un error, que es exactamente lo que
hace un fallo que no da error.

Hoy **las tres funciones leen con el cliente admin y ya no reciben un cliente**.
Dejarles el parámetro era dejar abierta la puerta por la que entró: quien escriba
la próxima pantalla pasaría la sesión, que es lo natural, y la lista volvería a
venir corta y callada. El permiso lo pone la pantalla. Vale notar que **las rutas
que agregan y sacan gente de esas listas ya usaban el cliente admin**: el agujero
estaba sólo en la lectura que las dibuja, que es el tipo de asimetría que no se
ve revisando una ruta sola.

**El alta es la excepción**: la puede hacer cualquier usuario activo del
sistema, tenga o no el módulo, desde `/mis-pedidos`. Son nueve áreas las que
piden materiales y exigirles un permiso convertiría a Compras en un cuello de
botella. Pedir no compromete nada; aprobar y comprar sí.

## Pantallas

| Ruta | Para qué |
|---|---|
| `/compras` | Indicadores, gasto por mes/área/empresa, principales proveedores |
| `/compras/requerimientos` | Listado completo con filtros, paginado en el servidor |
| `/compras/requerimientos/[id]` | Ficha: datos, aprobación, gestión de compra, **comparativa editable** e historial |
| `/compras/para-aprobar` | Bandeja de quien aprueba: lo suyo arriba, lo de otros abajo |
| `/compras/aprobaciones` | Cola por urgencia y antigüedad, con aprobación en tanda |
| `/compras/tablero` | Para comprar → En comparativa → Pedido |
| `/compras/presupuestos` | Cargar de una vez la respuesta de un proveedor: proveedor, fecha y planilla una vez, y después los renglones (ver `## Cargar la respuesta de un proveedor`) |
| `/compras/proveedores` | Padrón compartido con Mantenimiento, con volumen por proveedor |
| `/compras/ubicaciones` | Catálogo de "dónde se necesita", con detección de duplicados y fusión |
| `/compras/configuracion` | Estado de la sincronización con la planilla |
| `/mis-pedidos` | Fuera del módulo: cualquier usuario pide y sigue lo suyo |

**Aprobar no es un nivel: es estar en la lista** de `/compras/configuracion`.
Vale para las dos aprobaciones —la del requerimiento y la de la compra— y no
alcanza con ser administrador del módulo ni del sistema. Administrar es
configurar; aprobar es autorizar plata, y las hacen personas distintas.

Aprobar una compra pide las dos cosas: estar en la lista y ser la persona a la
que se le asignó.


## La comparativa

Los presupuestos se cargan en la ficha del RI, no en Google Sheets. El circuito
es el que sigue:

1. Compras **elige de la carpeta de Drive** la planilla de comparativa de ese
   artículo. Los nombres de los archivos son genéricos y no dicen a qué RI
   corresponden, así que lo elige la persona; el vínculo real es la columna A.
2. Compras **carga cada presupuesto** en un formulario con los campos de la
   planilla: proveedor, marca, unidad, precio unitario, cantidad, envío,
   descuento, IVA, hasta cuándo vale el precio, plazo de pago, condiciones,
   disponibilidad y comentario. Cada uno queda también como fila en la planilla.
3. Compras pasa el RI a **Para comprar** y designa a quién le toca.
4. Esa persona **aprueba la compra eligiendo un presupuesto**. Es un solo acto.
5. Al registrar el **Pedido**, el proveedor y los costos se bajan del
   presupuesto elegido en vez de tipearse otra vez.

**Cuántos presupuestos alcanza lo decide Compras.** No hay mínimo: hay casos de
proveedor único y casos urgentes donde exigir tres frena el pedido sin motivo. Lo
único que se exige para avanzar es que haya algo que mirar.

**El total suma el envío.** La fórmula de la planilla lo dejaba afuera, y eso
hace que dos presupuestos no sean comparables cuando uno cobra el flete y el otro
no. Lo calcula la base, en una columna generada, para que la cuenta viva en un
solo lugar:

```
total = unitario × cantidad × (1 − descuento) × (1 + IVA) + envío
```

**La comparativa se muestra de dos formas.** Mientras Compras la arma, una fila
por proveedor: el trabajo es administrar filas. Cuando le toca decidir a la
persona asignada, la comparación pasa a ser una matriz —atributos en filas, un
proveedor por columna, con la diferencia contra el más barato— porque ahí el
trabajo es comparar. En el teléfono esa vista se convierte en tarjetas apiladas.

**Al aprobarse la compra, la comparativa se congela.** Desde ahí es el respaldo
de por qué se eligió ese precio: no se agrega, no se edita y no se borra.

## Buscar entre las comparativas bajadas (26/11/2026)

`/compras/comparativas` es una pantalla de consulta: busca entre **todo lo que
se cotizó alguna vez** por producto, marca o número de RI, y por proveedor. Hasta
ahora eso sólo se podía mirar desde adentro de un pedido —entrando al RI 1340 se
ve lo que se cotizó para el RI 1340— y la pregunta al revés, «¿cuándo pedimos
esto antes y a cuánto nos lo cotizaron?», no tenía dónde hacerse.

Cuatro cosas que no se deducen del código:

**Se agrupa por artículo porque agrupar por pedido no mostraría nada.** Medido
el 26/11/2026 sobre las 1.078 cotizaciones importadas: están repartidas en 1.031
requerimientos y **1.002 de ésos tienen una sola cotización**. Sólo 29 pedidos
tienen dos o más, así que «la comparativa del pedido X» es casi siempre una fila
sola. Las mismas 1.078 caen en **840 artículos**, de los que **139 tienen dos o
más**: son los consumibles que se vuelven a pedir —correas, filtros, guantes—,
que es justo donde saber el precio anterior sirve para algo. El agrupador es
`clave_articulo` y no la descripción, que es lo que hace que «CORREA C-153» y
«Correa C 153» sean el mismo artículo.

**Cotizaciones y pedidos no son lo mismo, y la cabecera muestra los dos.** El
artículo más cotizado tiene **9 cotizaciones que son todas del RI 1865** —dos
proveedores compitiendo por una compra: eso es una comparativa— mientras que
«Filtro aceite motor» tiene 8 repartidas en pedidos de siete meses distintos, que
es historial. Son dos cosas y el total solo no las distingue: hay **139 artículos
con 2+ cotizaciones contra 119 con 2+ pedidos**, y los 20 de diferencia son
artículos pedidos una sola vez con varios presupuestos. Por eso el filtro «sólo
los pedidos más de una vez» mira **`pedidos` y no `veces`**: escrito al revés
—que fue como salió la primera versión— el filtro contradice su propia etiqueta.

**No reemplaza al histórico de la ficha del RI, y no es el mismo dato.**
`lib/compras/historicoDelArticulo.ts` mira `monto_conocido`, o sea **lo que la
compra terminó costando**, y se muestra adentro de un pedido para el artículo de
ese pedido. Esta pantalla mira lo que **se cotizó**, que incluye a los
proveedores a los que después no se les compró — que son justamente los que dejan
comparar. Los dos conviven a propósito.

**Un artículo cotizado en dos monedas no tiene rango de precio, y lo dice.** No
es un caso teórico: de los 840 artículos hay uno así —el de las 9 cotizaciones—,
porque entre las 1.078 hay una sola en dólares. Un mínimo que compara 1.000 pesos
con 1.000 dólares no está incompleto, está mal; es la misma regla que el embudo
del CRM, donde el monto no se convierte nunca. Y va el rango y no un promedio por
lo que ya dejó escrito `resumenDelHistorico`: un solo número se lee como una
promesa, y el precio de un consumible salta.

Se ejercita contra los datos reales con
`npx tsx scripts/probar-buscador-de-comparativas.mts`, que corre la misma
consulta y las mismas funciones que la pantalla. La pantalla en sí **no se abrió
en un navegador**: está detrás del login, como casi todo el sistema.

## Cargar la respuesta de un proveedor (26/11/2026)

[Spec](superpowers/specs/2026-11-26-compras-carga-de-presupuestos-design.md) ·
[plan](superpowers/plans/2026-11-26-compras-carga-de-presupuestos.md). Vive en
`app/(app)/compras/presupuestos`, `app/api/compras/presupuestos` y
`lib/compras/` (`cargaDePresupuestos.ts`, `numeroDeCampo.ts`, `ecoDelSistema.ts`,
`bloqueDeFilas.ts`).

Es el primer paso de «que el sistema mande y las planillas se usen menos», y
parte de un número: de **1.077** presupuestos, **1.069** entraron leyendo la
planilla y **8** se cargaron en el SdG; en octubre y noviembre el SdG tocó la
comparativa **dos veces**, y en toda su historia hubo **una sola** cotización
marcada como elegida. Del otro lado hay **200 planillas** en Drive y tres se
editaron el mismo día. **No es que la comparativa no se use: el SdG no estaba en
el camino.** Ahora se carga acá y la planilla recibe una copia de respaldo.

Lo que no se deduce del código:

- **La unidad de trabajo no es un pedido.** Medido sobre 224 respuestas de
  proveedor, el **29%** cubre más de un pedido (máximo **7**) y sólo el **4%**
  cruza más de un artículo. Por eso la pantalla elige proveedor, fecha y
  planilla **una vez** y después suma renglones, cada uno con su pedido, en vez
  de colgar de un pedido como la carga de la ficha, que sigue existiendo.
- **La columna del id va por nombre y nunca por letra.** Las comparativas miden
  **16, 19 y 20** columnas, y `REPUESTOS MÁQUINAS` ya usa la **T** para `EQUIPO`
  con datos adentro («Doosan 300»): fijar la letra habría pisado el equipo de
  alguien, y escribir fuera del ancho real hace que Google rechace **la
  escritura entera**, no la celda.
- **La relectura dejó de borrar lo que cargó el sistema.** El «Volver a traer»
  borraba por número de fila sin mirar el origen, a propósito (el RI 1865 está
  en el comentario). Con la columna de id esa defensa se da vuelta: borraría la
  fila y después saltearía su eco, y el presupuesto desaparecería del sistema
  quedando sólo en la planilla. Ahora el borrado lleva `.neq("origen", "app")`.
- **Una fila sin id se reconoce por su número de fila, y eso es transición.**
  Es la única forma de reconocer las **8** filas escritas antes de que la
  columna existiera. Se borra el día que esas 8 tengan id. **Y alcanza sólo a
  ésas**: la cláusula vale para las `'app'` cuyo id **no** aparece escrito en la
  planilla, nunca para todas. Con todas adentro, una fila 150 que hoy es un
  presupuesto tipeado a mano del mismo pedido —porque alguien insertó filas
  arriba— se salteaba como si fuera eco propio, y ese presupuesto **no entraba
  nunca al sistema sin que nada lo dijera**. Lo decide `ubicarLoDelSistema()`.
- **Un `drive_fila` guardado envejece, y la relectura es donde se corrige.**
  Antes de esto, cada «Volver a traer» borraba la fila `'app'` y la reinsertaba,
  así que su número se re-sincronizaba solo. Ahora la cotización sobrevive **con
  el número que tenía el día que se escribió**, y en estas planillas se insertan
  filas en el medio. **El id es para reconocer y la fila para volver a tocar**, y
  un número viejo hace que el `DELETE` vacíe la fila de otro: ese presupuesto
  queda en blanco en la planilla y, como en la base sigue siendo `'drive'` con su
  `drive_fila`, la próxima relectura lo borra y no lo re-importa — desaparece de
  los dos lados. Por eso **la fila que trae un id conocido dice dónde está esa
  cotización hoy** y las dos relecturas corrigen ahí el número. Si esa corrección
  falla no se avisa en pantalla: no hay nada que la persona pueda hacer, y la
  próxima relectura lo reintenta.
- **Qué le pasa al id cuando se borra un presupuesto.** El `DELETE` vacía la
  fila, y eso incluye la celda del id, porque el ancho sale de
  `anchoDeLaFilaEscrita()` —el mismo con el que se escribió— y no de
  `COLUMNAS_COMPARATIVA.length`. **Esa distinción no es cosmética**: con las 19
  fijas, el uuid sobrevivía solo en una fila por lo demás vacía en las planillas
  de 19 y 20 columnas —donde `ID SISTEMA` cae en el índice 19 o 20— y sí se
  limpiaba en las de 16, o sea que el borrado terminaba dependiendo del ancho de
  la planilla, que es justo lo que ubicar la columna por nombre existe para
  evitar. Y la asimetría que queda escrita a propósito: si una fila quedara con
  el id de una cotización ya borrada, el sistema no la reconocería como eco —el
  id dejó de estar en la base— y **el presupuesto volvería a entrar como
  `'drive'`**, con los datos de la planilla y sin su marca de elegida. Es
  coherente con «sobre lo que está en la planilla manda la planilla», pero hay
  que saberlo antes de vaciar una fila a mano.
- **La planilla ya no le gana a una corrección del sistema, y eso es nuevo.**
  Con la fila `'app'` viva para siempre y salteada en la relectura, **una
  corrección tipeada en la planilla sobre una fila del sistema no llega nunca al
  SdG**. Es coherente con «el sistema manda», y es lo que esta rama vino a hacer,
  pero durante la transición se sigue cargando en Sheets y Compras va a corregir
  ahí por costumbre. El `PATCH` de un presupuesto ya avisa la mitad simétrica
  —«la fila de la planilla no se reescribió»—; ésta es la otra, y no tiene
  cartel: el cambio simplemente se queda en la planilla. Si hay que corregir un
  presupuesto que cargó el sistema, se corrige **en el sistema**.
- **La FECHA de la planilla es la de la respuesta, no la del pedido**: de 323
  filas comparables, el **74%** difiere, mediana **+3 días**, y 233 de 238
  son posteriores. Eso destapó que la carga por pedido venía escribiendo ahí la
  fecha equivocada, y obligó a la columna `fecha_respuesta` (migración
  `20261126135912`, aplicada). Si la cotización no la trae, va la de hoy: nunca
  la del pedido y nunca una celda vacía.
- **La ruta no es idempotente, y se defiende por dos lados.**
  `unique(requerimiento_id, proveedor_id)` ya no existe —la migración 026 lo sacó
  a propósito, porque el mismo proveedor puede cotizar dos marcas para el mismo
  pedido y hay **7 pares repetidos** en la base—, así que un segundo envío
  inserta todo de nuevo y reescribe las filas. La **pantalla** apaga el botón
  mientras el POST está en vuelo y no lo rehabilita tras un 201; ante un corte de
  red o un 502 no se sabe si el servidor guardó, así que queda apagado y hay que
  mirar la ficha de cada pedido. Lo que la pantalla **no** puede cubrir son **dos
  pestañas** —o la misma carga en el teléfono y en la computadora— y el «Ya los
  revisé» apretado sobre un 502 que sí había guardado: eso lo frena la **ruta**,
  con un **409** cuando un renglón es idéntico en
  `(pedido, proveedor, precio unitario, fecha de respuesta)` a uno insertado hace
  menos de dos minutos (`renglonesYaCargados`). **No es un `unique` y no toca el
  caso legítimo**: dos marcas tienen precios distintos. Si la consulta del freno
  falla no se frena nada — no se rechaza una carga por no poder comprobar que no
  es un duplicado.
- **El costo contra la cuota de Google se cuenta por planilla, y no es «1
  lectura + 1 escritura».** Son **3 o 4 lecturas y de 1 a 3 escrituras** por
  planilla: `leerComparativa` gasta dos (cabecera y valores), `asegurarColumnas`
  una más —siempre, aunque no tenga nada que ensanchar—, y `agregarFilas` la
  columna A y el bloque; las escrituras de más son el encabezado `ID SISTEMA` y
  el ensanchado de la hoja, sólo la primera vez. El número importa porque se
  razona contra las **60 lecturas por minuto** que comparten los siete módulos.
  Lo que sí se cumple es que **nada de eso es por renglón**: siete renglones en
  una planilla cuestan lo mismo que uno.
- **El desplegable de planillas se pagina, y eso ya hacía falta.** La carpeta
  tenía **200 planillas** el 26/11/2026 y `listarComparativas()` pedía 200: ya
  estábamos en el tope. La 201 habría empujado a otra afuera y **el único síntoma
  es que no aparece** — quien la busca elige «Sin elegir», el presupuesto se
  guarda sin respaldo, y el aviso dice «no tiene comparativa vinculada», que
  manda a mirar el pedido cuando el problema estaba en la lista. Se sigue
  `nextPageToken`, que viene en la misma respuesta siempre que esté nombrado en
  `fields`.
- **Si Drive falla, lo cargado queda** y el fallo se dice en pantalla nombrando
  la planilla y los pedidos. No hay cola porque el libro de comparativa no tiene
  columna de pendiente: `compras_cotizaciones` no la tiene y el
  `sheets_pendiente` del pedido es del master. Por eso la ruta está declarada
  `pantalla` en `revisar-exportaciones`. El avance de estado al master sí va por
  cola y anota su pendiente **antes** del `after()`, para cubrir también el
  corte por `maxDuration`.
- **El pedido sin comparativa vinculada ahora avisa.** Antes el `if` no tenía
  `else` y se pasaba en silencio: son **63 de los 102** pedidos candidatos.
  Cargar un presupuesto le vincula la planilla.
- **El parseo de números decide plata** y por eso vive en
  `lib/compras/numeroDeCampo.ts`, con tests. Con los dos separadores, el decimal
  es el que está más a la derecha (`"12.500,50"` → 12500,5 y `"1,234.56"` →
  1234,56). **Trampa viva: `PresupuestoForm.tsx` todavía tiene su propio `num()`
  copiado, y ahí `"12.500"` da 12,5, mil veces menor y en silencio.** No se tocó
  porque es una pantalla en uso diario y la decisión es del usuario.
- **«Vacío» y «no se pudo leer» no son lo mismo, y confundirlos elegía
  proveedor.** La pantalla mandaba `(num(campo) ?? 0) / 100` para IVA y
  descuento: alguien que tipea `"21%"` en un campo rotulado «IVA %» cargaba
  **IVA 0**, la fórmula de la planilla daba un total **21% más bajo** que el de
  los otros proveedores, y en una comparativa donde gana el más barato eso
  decide la compra. Lo mismo perdía entero un `"1.500 $"` en envío y un
  `"cuatro"` en cantidad. Ahora `numerosDelRenglon()` separa las dos cosas: **un
  campo vacío sigue valiendo 0** en IVA y descuento —y `null` en precio,
  cantidad y envío, porque una celda sin cantidad no es una cantidad de cero—, y
  **un texto que no se pudo leer se rechaza y se nombra** antes de mandar nada,
  con el renglón y el campo. Es la misma vara que la ruta ya aplicaba al precio
  unitario, un piso más arriba.

**Los 8 presupuestos viejos se dejan como están: no se les escribe el id.**
Medido contra producción **el 26/11/2026** —la fecha importa, porque es un
número que alguien invalida el día que les escriba los ids—, los 8 tienen
`drive_fila` y ninguno está elegido, así
que la cláusula de transición ya los reconoce y no se duplican ni se borran.
Escribirles el id pediría escribir en 8 planillas de producción, que es una
acción de otro peso que una limpieza. **Queda una pregunta sobre el dato, no
sobre el código, para el usuario:** dos de esos ocho son del **mismo pedido y la
misma fila** (RI `0622980c`, fila 19), o sea una fila de planilla con dos
cotizaciones en la base. Antes la relectura borraba las dos y volvía una;
ahora sobreviven las dos y la fila se saltea, así que ese pedido pasa de **1
presupuesto a 2**.

## Pasar varios pedidos a comparativa de una vez (27/11/2026)

En el listado de `/compras/requerimientos` cada pedido que puede arrancar la
comparativa lleva una casilla; con uno o más elegidos aparece una barra con
**Pasar a comparativa**. Existe porque el circuito deja los pedidos aprobados
en `SIN_INICIAR` hasta que alguien los pone a juntar presupuestos, y eso se
hacía de a uno: medido el 27/11/2026 hay **62 pedidos aprobados esperando
ahí**, el más viejo del 20/08, o sea 62 idas y vueltas a la ficha.

Cuatro cosas que no se deducen del código:

**La planilla no se escribe entera en esa llamada, y no es una omisión.**
`reintentarPendientes` —el reintento que ya existía— hace **cinco pedidos por
corrida** y espera un segundo entre cada uno, porque «la cuota es por minuto y
ocho escrituras seguidas por cada uno la agotan en ráfaga». Un pedido que pasa
a comparativa se lleva la aprobación y las dos columnas a mano del master más
las de compra en la hoja de su área: del orden de media docena de escrituras,
que por sesenta pedidos son cientos. Así que el orden es **cola primero,
escritura después**: se guarda el estado de todos en un `update`, se les deja
`sheets_pendiente` puesto **antes** de tocar Google, y recién ahí se exportan
los que entren en el presupuesto de tiempo —cada exportación que sale bien
borra su propio pendiente—. Al revés, un corte dejaría pedidos cambiados en la
base, sin escribir en la planilla y sin nadie anotado para reintentarlo. Lo que
queda en la cola lo drena el cron de `compras-sync`, que corre cada diez
minutos y toma cinco por vez.

**Pasar un pedido a comparativa lo saca de la mano de la planilla, para
siempre.** El trigger de `editado_en_app` marca el pedido en cuanto cambia
`estado_compra`, y desde ahí la importación deja de pisarlo. De los 62, **60
todavía no estaban marcados**. No es una consecuencia nueva —avanzarlos uno por
uno hace lo mismo— pero de a sesenta es un solo paso grande, y por eso el
cartel de confirmación lo dice antes y no después.

**El historial se firma por tres condiciones y no por `usuario_id is null`.**
El `PATCH` de un pedido suelto le pone autor a la fila del trigger filtrando
por el RI y por «sin autor», y acá parecía natural cambiar el `eq` por un `in`.
No lo es: **4.032 de las 4.180 filas del historial no tienen autor** —las
escribe la sincronización de la planilla—, así que un `in` sobre 62 pedidos no
toca la fila recién creada sino toda su historia anterior. Medido: serían **57
filas viejas** firmadas con ese nombre y con la nota de la tanda, y **56 de
ellas son cambios de `estado_aprobacion`**, o sea justo el registro de quién
aprobó cada pedido. Por eso el `update` pide el campo, el valor nuevo y haber
nacido después de que la tanda empezara.

**Lo que no puede pasar no muestra casilla.** La regla vive en un solo lugar
—`motivoPorElQueNoPasa()` de
[lib/compras/pasarAComparativa.ts](../lib/compras/pasarAComparativa.ts)— y la
usan la tabla, la tarjeta del teléfono y el servidor, para que la casilla no
aparezca sobre algo que después va a ser rechazado. Son cuatro motivos
distintos y los cuatro existen en los datos de hoy: 89 sin aprobar (ahí entran
los **27 denegados** que siguen en `SIN_INICIAR`, filas viejas de antes de que
denegar pusiera `estado_compra: "DENEGADO"` — una selección de «todos» no los
revive), 33 ya en comparativa, **20 en espera** —que están frenados a propósito
y salen por su propia puerta, la que guarda `etapa_previa`— y 2.178 más
adelante en el circuito.

Se ejercita contra los datos reales, sin escribir nada, con
`npx tsx scripts/probar-pase-a-comparativa.mts`.

## El semáforo de pedidos y el reclamo (12/11/2026)

`/mis-pedidos` pinta de verde, amarillo o rojo los pedidos que **esperan a
Compras**, y en los amarillos y rojos del área propia ofrece **«Reclamar»**:
abre el hilo de mensajes de ese RI con la pregunta redactada y los gestores de
Compras marcados. El diseño está en
[el spec](superpowers/specs/2026-11-12-compras-semaforo-y-reclamo-design.md) y
[el plan](superpowers/plans/2026-11-12-compras-semaforo-y-reclamo.md).

Seis cosas que no se deducen del código:

- **Los cortes son 30 y 90 días, y salieron de medir.** Con 10/30 quedaban 50
  de 106 en rojo y Mantenimiento abría la pantalla con 33 reclamos posibles;
  con 30/90 abre con 11. **El rojo tiene que costar poco de atender o deja de
  significar algo** — que es exactamente lo que ya le pasó a la prioridad de
  este módulo, con el 42% de los abiertos marcados `URGENTE`.
- **`EN_ESPERA` queda afuera del conjunto reclamable**, y es lo que evita que
  esto se muera en la primera semana: **9 de los 10 pedidos más viejos estaban
  ahí**, frenados a propósito. Sin excluirlos, lo primero que ve el área arriba
  de todo son pedidos que alguien congeló, y el primer reclamo se contesta con
  «ése está en espera».
- **El eje es la fecha de requerimiento y no la de necesidad.** La segunda está
  cargada en 539 de 540, pero el **91% ya está vencido** y el margen mediano
  entre pedir y necesitar es de **4 días**: la gente escribe «lo necesito ya»,
  así que esa fecha no ordena nada.
- **El destinatario sale del grant explícito de `usuario_modulos`, nunca de
  `nivelEnModulo()`.** Esa función le devuelve `admin` a todo `admin_sistema`
  sin mirar el grant: por ahí entraría una quinta persona que en Compras tiene
  `lectura` explícita. Es el mismo error que ya se pagó con
  `compras-por-aprobar`, que le llegaba a 6 personas de las cuales 3 no podían
  aprobar. Hoy los cuatro del grant coinciden con `compras_aprobadores`, pero
  son dos listas distintas por definición y pueden divergir.
- **El orden por defecto no cambia; al filtrar por un color, sí.** Medido para
  Mantenimiento —1.125 pedidos, 23 páginas— los 11 rojos caían en las páginas
  5, 6, 7, 11, 12 y 15 y **la página 1 no tenía un solo punto de color**: con
  el orden de siempre el semáforo era invisible. Y el orden sin filtro se deja
  porque esta pantalla también sirve para buscar si alguien ya pidió lo mismo,
  y eso se navega por número.
- **Hay 5 pedidos que esperan a un aprobador y no a Compras** (`estado_aprobacion
  = PENDIENTE`). Hoy no se nota porque las dos listas coinciden; el día que
  dejen de coincidir, esos reclaman a quien no decide.

Y una decisión de palabras que es una decisión de datos: el renglón dice
**«último mensaje»** y no «reclamado». El hilo guarda cualquier conversación
sobre el pedido, y el dato no sabe cuál fue un reclamo.

## Para qué OT se pidió un RI

Un RI puede recordar de qué orden de trabajo nació (`ot_id`) y de qué renglón de
repuesto (`ot_repuesto_id`), y la ficha lo dice arriba de «Entró al pañol».
Tres cosas que no se deducen del código:

- **Recordar el origen no dice que el repuesto se haya aplicado.** Eso es otra
  pregunta (la mitad B de la trazabilidad); esta línea sólo cuenta de dónde vino
  el pedido.
- **La planilla no trae nunca esas dos columnas**, así que la fusión las
  conserva y `fusionDeLaPlanilla` no tiene rama de planilla para ellas: no es un
  olvido. Sacarles la protección haría que la sincronización las borre.
- **La OT se lee con el cliente admin** porque `ordenes_trabajo` está cerrada
  con `mant_puede_ver()`; lo ve cualquiera que abra la ficha, que es la
  procedencia de su propio pedido. Si la orden se borró (`on delete set null`)
  la línea no se dibuja.

## Dar de alta un proveedor desde el presupuesto (24/11/2026)

### De qué empresa es el proveedor (24/11/2026)

En Odoo funcionan **dos perfiles** —POLCECAL es la `res.company` 1 y POLYSAN la
2— y en el SdG el padrón de proveedores es **uno solo**, compartido por los
catorce módulos. Esa unificación no se toca: lo que faltaba no era partir el
padrón, era que cada proveedor dijera con cuál de las dos trabaja. Hasta esta
fecha eso **no existía como dato** y lo decidía el pedido que estuviera
cotizando, que es otra cosa: el pedido dice quién paga **esa** compra.

Vive en dos columnas de `proveedores` —`empresa_id` y `trabaja_con_ambas`—,
excluyentes por el check `proveedores_empresa_o_ambas`. Se elige en el alta
(arranca en lo que dice el pedido y se puede cambiar) y se corrige después en
`/compras/proveedores`, que además filtra por empresa.

Cuatro cosas que no se deducen del código:

- **Son dos columnas y no un enum de tres valores**, para que sea la misma
  forma que `compras_requerimientos` (`empresa_id` + `paga_ambas`) y la
  traducción a company_ids de Odoo la haga **una sola función** en vez de dos
  que se parecen. Un enum `('POLCECAL','POLYSAN','AMBAS')` habría metido los
  nombres de las empresas dentro de un check constraint, que es justo lo que
  `empresas.odoo_company_id` existe para evitar.
- **Null quiere decir «no se sabe» y no rompe nada**: quien lo lea cae en el
  comportamiento anterior, deducir la empresa del pedido. Por eso la columna
  pudo nacer con 393 de las 484 filas vacías.
- **El backfill escribió sólo lo probado.** De los 130 proveedores con enlace
  en `proveedores_odoo`, **91 lo tienen en las dos empresas**: que exista un
  `res.partner` suyo en los dos perfiles prueba que las dos le compraron, así
  que ésos quedaron en `trabaja_con_ambas`. Los otros 39 —24 sólo en POLCECAL
  y 15 sólo en POLYSAN— **quedaron en null a propósito**: un enlace en una
  empresa prueba que ésa le compró, no que la otra no pueda, y escribir «sólo
  POLCECAL» ahí es enlazar al que se le parece.
- **Pedir una empresa en el filtro trae también a los de las dos**, porque el
  que le vende a las dos le vende a ésa. Lo que no entra es el que no lo
  declaró, que tiene su propia opción —«Sin declarar»—, y que es la lista que
  hay que mirar para completarlos.

La precedencia al buscar en Odoo está en `destinoDelAlta()`: manda lo que la
persona eligió, después lo que dice el pedido, y sin pedido se miran las dos
—enlazar no escribe nada allá—. Con un pedido que existe pero no dice empresa
ni AMBAS (17 de 1.024) **no** se miran las dos: se avisa, porque que el pedido
no conteste no es lo mismo que no tener pedido.


Cargando un presupuesto, el proveedor que no está en la lista se da de alta ahí
mismo, con el botón **Nuevo** al lado del selector. No es una comodidad de
pantalla: es el primer eslabón de la cadena «cargo la cotización y, si avanza,
le genero la orden de compra», que se cortaba en el último.

**El CUIT es obligatorio acá y no en `/compras/proveedores`.** No es una
inconsistencia: este camino existe para llegar a una orden de compra y aquél
no. Medido el 23/11/2026, de los 45 proveedores cotizados en 180 días que no
pueden llegar a una orden, **40 no tienen CUIT** — y sin CUIT no se puede ni
buscar si el proveedor ya está en Odoo ni crearlo sin arriesgar un duplicado en
la contabilidad. En la pantalla de administración sigue siendo opcional, porque
ahí se cargan también contratistas que nunca van a tener una orden en Odoo.

Seis cosas que no se deducen del código:

- **El alta lee Odoo y no le escribe.** Busca el `res.partner` por CUIT y lo
  enlaza si ya está; si no está, no crea nada y lo dice. **El partner nuevo se
  crea al generar la orden**, que es cuando hay una compra de verdad detrás y
  la empresa ya la decidió el RI. Crear al dar de alta habría puesto en la
  contabilidad proveedores de presupuestos que no prosperan, y el 40% de los RI
  son AMBAS, o sea dos partners por alta.
- **Elegir entre varios candidatos es `elegirPartnerDelEmisor()`**, la de
  Facturación, y **no elegir es un desenlace válido**. Sabe que un `parent_id`
  puesto es un contacto hijo —una dirección de entrega, no el proveedor—, que
  hay que ver los archivados para poder decir «está archivado» en vez de «no
  existe», y que con un empate real decide una persona. Copiar
  `cruzarProveedores()` en su lugar enlazaría en silencio a una dirección de
  entrega.
- **La búsqueda por CUIT tolera los guiones.** De 1.639 partners con `vat` en
  Odoo, 1.636 son dígitos puros y **dos tienen guiones**. Un `["vat","in",…]`
  no los encuentra, la pantalla diría «no está en Odoo» y la orden crearía el
  partner que ya existía — que no se borra una vez que tiene documentos.
- **`supplier_rank: 1` al crear no es cosmético.** El cruce masivo de
  `/api/odoo/proveedores/enlazar` busca `[["supplier_rank", ">", 0]]`: sin eso
  el partner recién creado queda invisible para el cruce y volvería a aparecer
  como «no está en Odoo» aunque esté.
- **`/api/compras/proveedores/con-odoo` escribe `proveedores_odoo`, que es una
  tabla de `admin`.** Es un ensanche deliberado y acotado: lo que se habilita
  no es «enlazar» sino «enlazar cuando el CUIT no deja lugar a dudas». El
  enlace se deriva del CUIT tipeado y lo frenan tres cosas —el CUIT repetido en
  el padrón, el empate que no se resuelve, y el partner que ya es de otro
  proveedor del SdG, que llega como un 23505 del `unique (empresa_id,
  odoo_partner_id)` y se traduce a «puede ser el mismo cargado dos veces»—.
- **Esto no destraba a los 40 que ya están en la lista sin CUIT.** El modal es
  para el proveedor que **no está**; los que el importador de la comparativa
  creó con el nombre y nada más se completan en `/compras/proveedores`. Lo
  único que ganan es que el cartel del ensayo pase a decir la verdad: que falta
  el CUIT, no el enlace.

No hizo falta ninguna migración. El diseño está en
[el spec](superpowers/specs/2026-11-23-compras-alta-de-proveedor-desde-el-presupuesto-design.md)
y el plan en
[el plan](superpowers/plans/2026-11-24-compras-alta-de-proveedor-desde-el-presupuesto.md),
con la lista de lo que **sólo se puede comprobar en la primera corrida real** —
el Odoo de local es staging y está congelado desde el 11/09/2026—. La primera
prueba va con un RI de **una sola empresa**, no con uno de AMBAS: si algo sale
mal, hay un partner que archivar y no dos.

## El CUIT que falta se avisa al elegir al proveedor (26/11/2026)

El circuito ya frenaba por esto: `armarOrdenes()` devuelve `sin cuit` y el
mensaje dice qué hacer. El problema era **cuándo** lo dice — al generar la orden,
o sea después de pedir los presupuestos, cargarlos, armar la comparativa y
aprobarla—. Medido el 23/11/2026: de los 45 proveedores cotizados en 180 días que
no llegan a una orden, **40 no tienen CUIT**.

Desde el 26/11/2026 el aviso aparece antes, en dos momentos y sin frenar nada:

- al **elegir al proveedor** en el formulario de presupuesto, como un renglón
  debajo del selector;
- al lado de su nombre en **los tres lugares donde se mira la comparativa** — la
  tabla, la matriz de decisión y las tarjetas del teléfono— con un `· sin CUIT`
  y el texto entero en el `title` (`MarcaSinCuit`).

Tres cosas que no se deducen del código:

- **No bloquea, a propósito.** A veces se cotiza para comparar y la compra
  termina en otro proveedor. El freno sigue donde el dato es imprescindible.
- **Un CUIT inválido avisa distinto que uno que falta.** La consecuencia es la
  misma —Odoo no lo reconoce— pero un dato ausente y uno mal tipeado no se
  buscan en el mismo lugar, y por eso `avisoDeCuit()` devuelve dos textos y la
  marca dice `· CUIT inválido`. El dígito verificador lo comprueba
  `cuitEsValido()`, que ya existía.
- **El `cuit` viaja en `ProveedorElegible` sin completar ningún campo.** Es el
  único dato de la ficha del proveedor que va al formulario y no se autocompleta
  en ningún lado: está sólo para poder avisar.

Al 26/11/2026 son **267 de 484** los proveedores sin CUIT, así que el aviso no es
un caso raro: es uno de cada dos. Por qué son tantos y por qué cargarlos no es
sólo cuestión de escribirlos está en la sección «El padrón tiene a la misma
empresa dos veces» de [ODOO-INTEGRACION.md](ODOO-INTEGRACION.md).

De ahí sale también la otra punta: **`/compras/proveedores/duplicados`**, la
pantalla de admin que fusiona las fichas de la misma empresa cargada dos veces
—105 grupos al 26/11/2026—, que es el camino para 111 de los CUITs que no se
pueden escribir. Se entra desde «Cargados dos veces», en la lista de
proveedores. Borra una fila del padrón, así que **se audita con `borrar`**, y lo
que hay que saber antes de tocarla —cuál queda la decide la planilla y no la
actividad, el orden de las cuatro escrituras, y las dos clases de choque— está
en la sección «La pantalla para fusionarlos» de ese mismo documento.

## Integración con el resto del SdG

- **Proveedores viven en el núcleo**, no dentro de Compras. Mantenimiento ya
  guardaba el contratista de cada OT como texto libre; ahora
  `ordenes_trabajo.proveedor_id` apunta al mismo padrón, sin perder el texto
  original (mismo patrón que `equipo_raw` / `equipment_id`).
- **"Dónde se necesita"** es un catálogo propio (`compras_ubicaciones`) con las
  38 ubicaciones de la planilla. No se usan los `sectores` del núcleo porque
  son organizativos (Calidad, Finanzas) y no lugares físicos: ninguno cruza.
  Cada ubicación puede apuntar opcionalmente a un sector o a un equipo, y ese
  enlace vive en el catálogo, no en cada requerimiento — cuando se cargue la
  flota real hay que mapear 38 filas una vez, no 1825. `ubicacion_raw` conserva
  el texto original de la planilla como respaldo.
- **"Paga: Ambas"** se guarda como `empresa_id = null`, igual que
  `sectores.transversal` resuelve el "AMBOS" de Mantenimiento. Es habitual:
  pasa en más de un tercio de los RI.

## Puesta en marcha

Aplicar las migraciones en orden:

1. `015_nucleo_compras_enum.sql` — agrega `compras` al enum de módulos.
2. `016_nucleo_ajustes_compras.sql` — padrón de proveedores y funciones de permisos.
3. `017_compras_schema.sql` — tablas del módulo.
4. `018_compras_rls.sql` — políticas.
5. `019_compras_ubicaciones.sql` — catálogo de "dónde se necesita".
6. `020_compras_aprobar_explicito.sql` — aprobar exige estar en la lista.
7. `021_compras_alias_planilla.sql` — alias de cada aprobador en la planilla.
8. `022_compras_sheets_pendiente.sql` — qué quedó sin escribir en la planilla.
9. `023_compras_sin_valores_por_defecto.sql` — prioridad y quién paga sin default.
10. `024_compras_estado_aprobado.sql` — el estado `APROBADO` (va sola).
11. `025_compras_circuito_compra.sql` — asignación y aprobación de la compra.

**Hay que correrlas de a una**, no pegadas en una sola ejecución. La 015 tiene
una sola sentencia a propósito: Postgres no deja usar un valor de enum nuevo
hasta que su transacción commitee, y el editor SQL de Supabase corre cada script
en una transacción. Si 015 y 016 van juntas, falla con
`55P04: unsafe use of new value "compras"` — porque el cuerpo de
`puede_editar_compras()` menciona `'compras'` y se valida al crear la función.

Después, dar acceso al módulo desde `/administracion/usuarios`.

### Si la base ya tuvo el repo COMPRAS suelto

Antes de portarlo, Compras existió como app aparte
(`procedimientos-polcecal/COMPRAS`, hoy archivado). Si sus migraciones llegaron
a correrse en esta base, hay dos choques:

- `rol_actual()` allá devolvía `text` y leía de `app_users`; acá devuelve
  `user_role` y lee de `usuarios`. Postgres no deja cambiarle el tipo de
  retorno a una función existente, así que **la 002 falla** con
  `42P13: cannot change return type of existing function`.
- La tabla `proveedores` ya existe con `bigserial`, y la **015 falla** al
  intentar crearla con `uuid`.

Se resuelve con `supabase/limpiar-compras-standalone.sql`, que verifica que esas
tablas estén vacías antes de borrarlas. El histórico no se pierde: se recarga
desde el xlsx con el importador.

### Importar el histórico

```bash
node scripts/import-compras/import.mjs "C:/ruta/PEDIDOS DE COMPRA.xlsx" --dry-run
```

El `--dry-run` no escribe: informa cuántos registros fusionó, cómo quedaron los
estados y cuántas ubicaciones pudo resolver contra sectores y equipos. Sin ese
flag escribe usando `SUPABASE_SERVICE_ROLE_KEY`.

Es idempotente (upsert sobre `nro_ri`), se puede correr de nuevo.

Verificado contra la planilla real: 1825 RI, 9 áreas, 163 proveedores tras
unificar variantes de nombre (`MORC` y `MORC SRL` son uno solo).

## Sincronización con Google Sheets

Ver [COMPRAS-SINCRONIZACION.md](COMPRAS-SINCRONIZACION.md).

## Notas sobre los datos

- Fechas y montos del xlsx son celdas reales de Excel, no texto: la importación
  es exacta y no hay ambigüedad día/mes.
- Hay `FECHA DE REQUERIMIENTO` mal cargadas en la planilla (por ejemplo
  `3/16/16`). No se corrigen: se respeta el dato original.
- 40 requerimientos sin estado quedan como `PENDIENTE`.
- **El 68% de los RI está marcado `URGENTE`.** La prioridad perdió capacidad de
  discriminar; vale la pena revisar el criterio con los usuarios.
