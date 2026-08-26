# Mantenimiento — integrar las features de la app aparte

La app `procedimientos-polcecal/mantenimiento` y el módulo Mantenimiento de este
ERP son **dos versiones divergentes de la misma app**. Integrar no es migrar: es
portar el delta de features contra las tablas que este ERP ya tiene.

La guía del repo de origen —`INTEGRACION.md`, `integracion-delta.sql`,
`integracion-permisos.sql`— es la referencia. Acá quedan las decisiones tomadas
y lo que hay que saber para retomar.

## Estado

La base ya tiene aplicados el delta y los permisos: las 10 tablas nuevas
existen, `ordenes_trabajo` y `equipos` tienen sus columnas, y los helpers
`mant_nivel()` / `mant_puede_ver()` / `mant_puede_editar()` / `mant_es_admin()`
responden.

Las siete features están portadas. Lo que falta para que anden es
configuración, no código:

| Falta | Para qué |
|---|---|
| `GOOGLE_SHEETS_COMPARATIVAS_ID` | `1I2m7K2eUelBXjTp3uoRI0CjWd52gkIdSlmC2mjId1io` |
| `GOOGLE_SHEETS_AVISOS_ID` | `1Iyfy3AzEASPpYU3zNBKr3rg5BkAM_DC1X9E8RJo6ZX4` |
| `GOOGLE_SHEETS_OT_ID` | `1aCMQlLnigQnO32p-IxDGjsFLu-5hv8pnD8_-zTML8Jo` |
| Migración 031 | Ejecuciones que cuelgan de una OT. |
| Migración 032 | Los contratistas pasan a `proveedores`. |
| **Cargar los equipos** | Hay **2** cargados, así que **1701 de 1728 OT** y 137 de 138 avisos quedaron sin equipo ni sector. Es el cuello de botella del módulo entero. |
| Compartir como **editor** | Las planillas de OT, OS y comparativas. Con lectura alcanza para sincronizar, no para escribir de vuelta. |
| El libro "BD Equipos" | La ficha técnica, los tipos y los componentes. |

Cada escritura en una planilla es best-effort y avisa qué no se pudo escribir,
así que la app sirve igual mientras eso se resuelve.

## Decisiones

**Las OS van aparte de Compras.** Decidido antes de empezar. El delta crea
`ordenes_servicio` y `os_comparativas` propias del módulo, aunque solapen con
`compras_requerimientos` y `compras_cotizaciones`.

**Los permisos no se duplican.** La guía propone un helper `mantNivel`; ya
existe como `nivelMantenimientoDe()` en `lib/mantenimiento/auth.ts`, desde antes
de esta integración. Se usa ése. Se sumó `esAdminMantenimiento()`, que faltaba
para las pantallas de configuración.

**`admin_sistema` es admin de los dos lados.** `mant_nivel()` miraba sólo
`usuario_modulos` mientras `nivelEnModulo()` le da admin a cualquier
`admin_sistema`. Con las dos reglas distintas, un admin del sistema sin grant
explícito veía los botones de edición y RLS le devolvía listas vacías. La
migración 029 alineó la base al código.

**Las tablas nuevas se renombraron al castellano.** Vinieron en inglés desde la
app de origen, en una base donde todo lo demás está en español. Se renombraron
estando vacías, que es cuando sale gratis:

| En el repo de origen | Acá |
|---|---|
| `production_plan` | `produccion_semanal` |
| `equipment_types` | `equipos_tipos` |
| `equipment_components` | `equipos_componentes` |
| `equipment_parts` | `equipos_repuestos` |
| `work_order_parts` | `ordenes_trabajo_repuestos` |

`avisos`, `operarios`, `contratistas`, `ordenes_servicio` y `os_comparativas`
ya estaban en español y sin prefijo, igual que `equipos` y `sectores`.

`produccion_semanal` y no `produccion_plan` porque ya existe
`planificacion_diaria` y son cosas distintas: una es el plan de trabajo del día,
la otra el estado de producción de la semana por sector. Nombres parecidos para
conceptos distintos es cómo se confunden después.

## Al portar código, renombrar

| En el repo de origen | Acá |
|---|---|
| `equipment` | `equipos` |
| `work_orders` | `ordenes_trabajo` |
| `plants` | `empresas` |
| `sectors` | `sectores` |
| `app_users` | `usuarios` |
| `equipment_checklists` | `equipos_checklists` |
| `maintenance_schedules` | `mantenimientos_programados` |
| `maintenance_executions` | `mantenimientos_ejecuciones` |

Y los chequeos de permisos:

| En el repo de origen | Acá |
|---|---|
| `role IN ('admin_sistema','administrador')` | `puedeEditarMantenimiento()` |
| `role === 'jefe_produccion'` (producción) | `puedeEditarMantenimiento()` |
| `role === 'admin_sistema'` (configuración) | `esAdminMantenimiento()` |
| `is_admin()` en RLS | `mant_puede_editar()` / `mant_es_admin()` |

## Las features, y en qué orden

Son proyectos independientes. Cada uno lleva su spec y su plan.

| | Feature | Estado |
|---|---|---|
| 1 | Cimientos: permisos y nombres | **hecho** (migración 029) |
| 2 | Avisos | **hecho** — sincronización y listado |
| 3 | Órdenes de trabajo | **hecho** (la foto a Drive quedó afuera) |
| 4 | Producción semanal | **hecho** |
| 5 | Órdenes de servicio y comparativas | **hecho** (falta el ID de la planilla de OS) |
| 6 | Equipos: ficha técnica, tipos, componentes, repuestos | **hecho** |
| 7 | Dashboard: KPIs y gráficos | **hecho** |

El dashboard va último porque mide sobre lo que las demás cargan. Las
integraciones con Sheets y Drive no son una etapa aparte: cada feature se lleva
la suya.

## La planilla de avisos, verificada

Se llama `AVISOS`, la pestaña también, y tenía 139 filas al portarla. Sus
columnas, contra la planilla de verdad:

`N° OA | FECHA | SECTOR | EQUIPO | DESCRIPCIÓN | URGENCIA | QUIÉN AVISÓ |
Column 10 | Column 11 | OT ASIGNADA | Imagen | Observaciones`

Tres cosas que sólo aparecieron al leerla:

- **El código de origen leía las observaciones de la columna K**, que hoy es
  `Imagen`. Los avisos con foto guardaban la URL de Drive como si fuera una
  observación. Acá la imagen va a `reference_photos` y las observaciones a L.
- **H e I son restos de una fórmula** que parte el nombre de quien avisó en dos.
  No se leen.
- **Una celda con `#REF!`** en la fila del aviso A1. Las celdas con error de
  fórmula se leen como vacías: guardar el mensaje sería guardarlo como si fuera
  un nombre.

La urgencia viene con emoji —`🟠 Alta`, `🟡 Media`, `🟢 Baja`—, así que se
busca la palabra adentro y no se compara la celda entera.

Se lee por posición de columna, como en el origen. Es frágil: si alguien inserta
una columna en el medio, se rompe en silencio. Conviene pasarlo a mapeo por
encabezado —como se hizo con las comparativas de Compras— la próxima vez que se
toque.

## La planilla de OT, verificada

Se llama `ORDEN DE TRABAJO`, la pestaña `OT`, y tenía 1.728 órdenes al portarla.
Sus columnas coinciden con lo que leía el código de origen:

`A N° OT · B fecha · C sector · D equipo · E especialidad · F tipo · G quién ·
H descripción · I repuesto · J ejecución · K cierre · L (calculada) · M estado ·
N contratista · O horas · P/Q/R operarios · S prioridad · T frecuencia ·
U próxima fecha · V fotos · W observaciones`

**La columna L no es el estado.** Se llama "Column 19" y trae un "Atrasado / al
día" calculado; el estado está en M. Confundirlas daría por atrasada media
planilla.

Estados: `Realizado`, `Atrasado`, `Por hacer`, `En proceso` — el mismo
vocabulario que ya usaba el ERP, así que la traducción portó directo.
Especialidades: `MECÁNICO`, `ELÉCTRICO`, `CIVIL`, `LUBRICACIÓN`.

Un guión suelto en un campo de texto se lee como vacío: es cómo se escribe "acá
no va nada" en una planilla, no un contratista llamado "-".

## "Requiere parar el sector": una diferencia con el origen

En la app de origen la marca sólo se pone **al crear** la OT: no hay forma de
marcarla después. Acá eso no alcanzaba, porque las 1.728 órdenes vienen de la
planilla y llegan todas sin la marca, así que la alerta no se vería nunca.

Se puede marcar y desmarcar desde el detalle de cualquier OT, sin confirmación:
es una marca que se pone y se saca, y quien la pone está mirando la orden
mientras lo decide.

La marca **no viene de la planilla ni vuelve a ella**: es un dato propio del
sistema. La planilla no tiene esa columna.

Ya se muestra en producción semanal y en el dashboard, al lado del nombre del
sector, y como indicador propio ("Sectores a parar").

## Registrar el trabajo de una OT

Dar por realizada una OT sin decir qué se hizo pierde justamente lo que sirve
después. Marcarla como "Realizado" abre el registro: cómo salió, cuándo, cuántas
horas, quiénes, y qué se encontró.

Queda de los dos lados. En el sistema como **ejecución**
(`mantenimientos_ejecuciones`), que hasta ahora sólo podía colgar de un
mantenimiento programado —la **migración 031** le suma `work_order_id`, porque
la mayor parte del trabajo de la planta entra por una OT—. Y en la planilla,
cada dato en su columna: M el estado, K el cierre, N el contratista, O las
horas, P/Q/R los operarios, W las observaciones.

**La columna L no se escribe nunca**: es la fórmula que calcula atrasado/al día,
y pisarla rompería el cálculo de toda la planilla.

**El estado se escribe como lo escribe la planilla.** La app guarda
`EN_PROCESO`; la planilla dice "En proceso". Escribirle el vocabulario de la app
la dejaría con dos formas del mismo estado y la próxima lectura no las
reconocería igual.

Antes de escribir se comprueba que la fila **siga siendo la de esta OT** —se lee
la columna A y se compara el número—. Si no coincide no se escribe nada y se
pide sincronizar: el número de fila se corre en cuanto alguien inserta una fila
arriba.

Escribir en la planilla es best-effort: si Google está caído, o la planilla no
está compartida como editor, el trabajo igual quedó registrado y la pantalla
dice qué falta completar a mano.

**La foto quedó afuera.** El origen la sube a Drive con un Apps Script propio
(`/api/fotos-drive`) y escribe el link en la columna V. Ese endpoint no existe
acá y montarlo es un proyecto aparte. La columna V ya está mapeada, así que
cuando haya dónde subirla es sumar el campo.

## Iniciar una OT pregunta por el equipo

Pasar una OT a "en proceso" quiere decir que alguien va a intervenir la máquina.
Si no se pregunta ahí en qué estado queda el equipo, el sistema termina
mostrando una máquina operativa mientras está desarmada.

El modal sólo ofrece los tres estados que tienen sentido durante un trabajo
—operativo, en mantenimiento, fuera de servicio— y pide motivo para los dos que
dejan la máquina parada. Si el estado elegido es el que ya tenía, no se registra
el cambio: una línea de historial que dice "pasó de operativo a operativo" es
ruido.

Cuando la OT no está enlazada a ningún equipo del sistema —pasa con las que
vienen de la planilla sin código reconocible— el modal lo dice y sólo cambia el
estado de la OT.

## Producción semanal

Una fila por semana y sector, con los siete días. La pantalla edita un día pero
manda la semana entera, que es como está guardada (`days`, `turnos` y `motivos`
son arreglos de siete en un `jsonb`). La API normaliza todo a siete antes de
guardar: un arreglo de otro largo rompería la grilla al leerla.

**Las fechas se arman con las partes locales, no con `toISOString()`.** El
origen calcula el lunes convirtiendo a UTC; la medianoche local de un huso
positivo cae el día anterior y la semana entera se corre. Vercel corre en UTC y
las pantallas en Argentina, así que acá la lógica de fechas vive en
`lib/mantenimiento/produccion.ts`, con tests.

Arranca en la semana que viene: es la que se planifica, no la que ya empezó.

Los sectores se agrupan por empresa porque la ventana de reparación se decide
por planta: si **todos** los sectores de una empresa están libres un día, ese día
se puede parar sin frenar el despacho. Al lado de cada sector se muestra lo que
tiene pendiente —OT y OS— para aprovechar la ventana, y la marca de "parar" si
alguna OT pendiente lo exige.

Las OS ya se consultan aunque la tabla esté vacía: la feature 5 la va a llenar y
la pantalla no necesita cambiar.

## Órdenes de servicio y sus comparativas

Una OS es un trabajo que se le pide a un **tercero** —una reparación, un
servicio, una fabricación—, a diferencia de la OT, que la hace el personal
propio. Van aparte de los requerimientos de Compras: aquéllos piden materiales,
éstas piden trabajo.

Son **dos planillas**:

- **OS**: una pestaña por área (`SERVICIOS`, `MANTENIMIENTO`, `TALLER VIAL`,
  `PRODUCCIÓN`, `LABORATORIO`, `ALMACÉN`, `INVERSIONES`, `DESPACHO`, `CANTERA`,
  `OTRA`). Cada pestaña arma su encabezado a su manera, así que se lee **por
  encabezado** y no por posición, con alias por columna. Las OS nuevas se cargan
  en `SERVICIOS`, la hoja maestra.
- **Comparativas** (`COMPARATIVA DE PROVEEDORES MANTENIMIENTO`): una pestaña por
  sector, quince columnas fijas A..O iguales en las doce, así que se lee por
  posición. Varias filas con el mismo N° de OS son las ofertas que se
  compararon; `ELECCIÓN` marca cuál se tomó.

### Verificado contra la planilla de comparativas

147 cotizaciones sobre 117 órdenes, leídas enteras con el parser del módulo:

- **El IVA viene como fracción** (0.21) leyendo sin formato, y como `"21%"`
  leyendo con formato. El código de origen hacía `Number("21%")` → NaN: con
  formato perdía el IVA de todas las filas.
- **21 cotizaciones no tienen IVA** cargado; ninguna se queda sin fecha ni sin
  total.
- **Dos OS tienen más de una cotización elegida** (147 y 207) y **siete no
  tienen ninguna**. La planilla lo permite; la app no: elegir una desmarca las
  demás, y lo hace por número de OS, que es lo que corresponde porque la 207
  está cotizada en dos pestañas distintas.
- **Tres OS tienen elegida una que no es la más barata** (49, 161, 181). Puede
  estar bien —plazo, garantía, quién puede venir mañana—, pero se muestra.
- Una fila de "Planta Filler 2" tiene la fecha en 2026 mientras sus hermanas
  dicen 2025: es un error de tipeo de la planilla, no de la lectura.

### La trampa de los decimales

`monto()` tenía que distinguir tres formas del mismo número: el que manda Sheets
sin formato (`1848315.535`), el que escribe una persona (`" $1.972.500,00"`) y
el que sale de `String(n)` al guardarlo. Tomar todos los puntos por separadores
de miles daba **mil veces el precio**: hacía aparecer diferencias de miles de
millones donde la elegida era, de hecho, la más barata. La regla es: con coma,
formato argentino; sin coma, un punto solo es decimal y varios son de miles.

### Escribir en la planilla

Antes de escribir en una fila se comprueba que **siga siendo la misma**: se lee
esa fila y se contrasta el N° de OS y el proveedor. El número de fila que
guardamos se corre en cuanto alguien inserta una fila en el medio, y escribir a
ciegas pisaría la cotización de otro proveedor —en Compras eso ya pasó: 238
filas quedaron marcadas mal.

Borrar una cotización **vacía** su fila en vez de eliminarla: eliminarla correría
todas las de abajo y dejaría mal el número de fila de las demás.

La sincronización de comparativas es un **refresco completo** —se borra el espejo
y se vuelve a leer— porque en la planilla se corrigen y se borran filas. Si no
se pudo leer nada, no se toca nada: una planilla inaccesible borraría el espejo
entero.

### La planilla de OS, verificada

Se llama `PEDIDO ORDEN DE SERVICIO` y tenía **220 órdenes** al portarla, del
28/11/2025 al 24/08/2026. Verla de verdad cambió el diseño, porque **casi toda
la planilla es fórmula**:

- **`SERVICIOS` no se escribe.** Sus columnas A..J son un
  `QUERY(IMPORTRANGE(...))` sobre la planilla de respuestas de un **formulario
  de Google**: ahí es donde la gente pide una OS. Sólo K (empresa) y L (estado)
  están escritas a mano. Su encabezado de la columna A dice literalmente
  `"je d"`, así que el número se toma por posición.
- **Cada pestaña de área es un `FILTER`** sobre SERVICIOS, filtrando por área y
  por estado `APROBADO`. A..K son fórmula; **el seguimiento vive de la L en
  adelante** —comparativa, proveedor, estado, costo, fechas, observaciones— y
  ésas sí son valores escritos a mano.
- Sólo `MANTENIMIENTO` tiene todas las columnas. Las demás no traen `CUIT` ni
  `FECHA DE PEDIDO`, y `SERVICIOS` no trae ninguna de seguimiento.

**Por eso no se puede crear una OS desde la app.** Una fila agregada quedaría
fuera del rango de la fórmula, sin número asignado y sin aparecer en ninguna
pestaña. Se pide por el formulario; en el ERP se le hace el seguimiento. El
botón "Nueva OS" se sacó y la ruta POST no existe.

**Y por eso el número de fila es inestable.** Cuando una OS entra o sale del
`FILTER` —basta con que le cambien el estado en SERVICIOS— las filas de abajo se
corren, pero el seguimiento escrito a mano **no se corre con ellas**. Antes de
escribir se comprueba que la fila siga siendo la de esa OS; y la sincronización
avisa si encuentra filas con seguimiento cargado y ninguna orden al lado. Hoy no
hay ninguna, pero es cuestión de tiempo.

Tres cosas más que sólo aparecieron al leerla:

- **El vocabulario es propio.** Los estados son `POR APROBAR`, `EN REVISIÓN`,
  `APROBADO`, `EN PROCESO (COMPARATIVA)` y `ACEPTADO`; las prioridades,
  `URGENTE`, `1 SEMANA`, `NORMAL` y `LEVE`. La pantalla ofrecía `PENDIENTE` y
  `ALTA/MEDIA/BAJA`, que no existen en ningún lado.
- **La comparativa es un `HYPERLINK`**: la celda muestra "LINK" y guarda la URL
  adentro. Guardar lo que se ve habría guardado la palabra. Las 31 de
  `TALLER VIAL` tienen link de verdad; las 167 de `MANTENIMIENTO` dicen "LINK"
  sin ningún link detrás.
- **39 filas tienen `-` en la columna del equipo.** Es cómo se escribe "acá no
  va nada", igual que en las OT.

De las 437 filas leídas salen **220 órdenes distintas**: las pestañas de área
repiten las de SERVICIOS. Gana la de área, que es la que trae el seguimiento —a
costa de su columna `ESTADO`, que significa otra cosa que la de SERVICIOS: allá
es el estado de aprobación, acá el del servicio—.

## La ficha técnica de los equipos

El módulo ya tenía los equipos —nombre, sector, estado, criticidad—. Lo que
sumó esta feature son los datos de **relevamiento**: marca, modelo, rodamientos,
tensión, rpm, dónde está físicamente, de qué está hecha y qué repuestos conviene
tener.

Va aparte del alta del equipo a propósito: son datos de otro momento y de otra
persona. Quien da de alta la máquina sabe su nombre y su sector; la marca del
rodamiento la anota quien la abre.

Se carga de dos maneras:

- **Importando el libro "BD Equipos"** (`Importar ficha técnica` en el listado),
  con sus tres hojas: `TIPO_EQUIPO`, `EQUIPOS` y `COMPONENTES`.
- **A mano**, desde la ficha de cada equipo.

**La importación no crea equipos.** Enlaza por código con los que ya están
cargados y devuelve la lista de códigos que no encontró, en vez de inventar
máquinas que nadie dio de alta.

**Una celda vacía no borra nada.** En la hoja significa "todavía no lo relevé",
así que la importación sólo escribe los campos que vinieron con algo. En el
formulario es al revés —vaciar un campo lo borra—, y por eso son dos funciones
distintas y no una con una bandera.

Tres cosas que se corrigieron respecto del código de origen:

- Usaba `Number(v) || null`, que **convertía el 0 en null**: un equipo con 0
  horas de marcha quedaba sin dato.
- Contaba como importados los componentes **aunque el insert fallara**
  (`if (!error) result.componentes += lote.length`), así que informaba éxito
  sobre filas que no se guardaron.
- Hacía `upsert(..., { onConflict: "componente_id" })` sobre filas cuyo
  `componente_id` puede ser nulo. Acá se separan: las que traen identificador se
  pueden reimportar sin duplicarse, las que no, se insertan y ya.

Esta hoja **no se pudo contrastar contra el archivo de verdad** —no lo tenemos—,
así que los alias de columna son deliberadamente amplios: `año_fabricacion` y
`anio_fabricacion`, con o sin mayúsculas, con o sin espacios.

## El tablero

El módulo ya tenía tablero —estado de equipos, sectores, vencidos, próximos—.
Lo que sumó la feature 7 es lo que las demás hicieron medible:

- **OT este mes**, **avisos sin OT**, **OS sin terminar** y **sectores a parar**.
- **Órdenes de trabajo por mes**, los últimos doce.
- **Ventanas para reparar**: los días de la semana que viene en que una planta
  entera queda libre, con cuánto hay pendiente para aprovecharlas. Es lo que
  vuelve útil la planificación de producción.
- La marca **Parar** en la tarjeta de cada sector que tiene una OT pendiente que
  lo exige.

Dos decisiones que valen la pena:

**Una empresa sin plan cargado no genera ventana.** Sin plan todos los días
parecen libres, y anunciar una ventana que nadie planificó es peor que no
anunciar ninguna.

**Los totales se cuentan en la base, no acá.** El tablero traía hasta 10.000
órdenes para contarlas en memoria; ahora usa `count` con `head`. Con 1.728
órdenes andaba, pero es exactamente la forma de romperse en silencio cuando la
planilla crezca —el mismo tope de filas que ya nos mordió en Compras—.

Los meses se arman con las partes locales de la fecha y no con `toISOString()`,
por lo mismo que en producción semanal: en un servidor en UTC el primero del mes
cae el último del anterior y las órdenes se cuentan en el mes equivocado.

## Un solo lugar para los proveedores

El delta trajo una tabla `contratistas` propia del módulo, con dos filas y una
sola columna. Pero `proveedores` existe desde la migración 016 con
`es_contratista`, y su comentario decía exactamente esto: distingue a quién
presta servicios de quién provee materiales, y un mismo proveedor puede ser las
dos cosas. La decisión ya estaba tomada en el repo; la **migración 032** la
cumple: pasa las dos filas, borra la tabla y suma `proveedor_id` a
`ordenes_trabajo`, `ordenes_servicio` y `os_comparativas`.

**El nombre en texto se conserva.** Es lo que dice la planilla y la planilla
manda; `proveedor_id` es el enlace que permite cruzar el trabajo de un proveedor
entre Compras y Mantenimiento.

### Lo que las planillas tienen para dar

77 proveedores distintos entre la comparativa de OS, la columna contratista de
las OT y el proveedor elegido de las OS. De ésos:

- **18 están escritos de más de una forma** y sólo cambian mayúsculas, acentos
  o puntos —"Candia" y "CANDIA", "NELO Electrónica" y "NELO electronica"—. La
  normalización los une sola.
- **Cinco pares son el mismo escrito corto y largo**: "Cortadi" y "Domingo
  Cortadi", "Villa Arrieta" y "Met. Villa Arrieta", "Don Alfredo" con sus tres
  variantes, "Giacobino" y "Cristian Giacobino", "Ing Mazzeo" e "Ing. Mazzeo".
  Ésos **no se unen solos**: decidir si son el mismo es de quien los conoce, así
  que se sugieren y se fusionan a mano.

Para sugerirlos hay una lista de palabras de rubro —metalúrgica, mecanizados,
ingeniería, transporte— que no identifican a nadie. Sin ella, "CN Mecanizados" y
"Gundel mecanizados" quedaban como el mismo proveedor por compartir el oficio.

### La sincronización no crea proveedores

Enlaza los que reconoce y **avisa** los que no, con un botón para sumarlos como
contratistas. Crearlos sola llenaría la lista que Compras usa todos los días con
cada variante de escritura que alguien tipeó en una planilla. Y el aviso muestra
primero cuáles parecen repetidos, que es el momento de unificarlos: después hay
que fusionar dos fichas.

## Lo que quedó anotado para decidir después

**Resuelto: los contratistas son proveedores.** Ver `## Un solo lugar para los
proveedores`.

**Al portar, revisar `UNFORMATTED_VALUE`.** La app de origen arregló un bug de
fechas en null leyendo Sheets sin formatear. Este ERP tiene su propio lector en
`lib/compras/sheets.ts` y ya se le corrigieron dos cosas parecidas —el día y el
mes dados vuelta, y las celdas ilegibles pisando estados—; conviene mirar los
dos lados antes de portar el de mantenimiento.
