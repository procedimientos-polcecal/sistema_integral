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

El código del ERP todavía **no usa nada de eso**: las tablas están vacías y no
hay pantallas. Portar las features es el trabajo pendiente.

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
| 3 | OT: sincronización, especialidad, parada de sector e inicio de OT hechos; falta registrar realizado | en curso |
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

### Lo que falta

**El ID de la planilla de OS.** El repo de origen nunca tuvo configurado
`GOOGLE_SHEETS_OS_ID`, así que no se pudo verificar su forma contra la planilla
de verdad como se hizo con las demás. El código está completo y responde
"Falta configurar GOOGLE_SHEETS_OS_ID" hasta que se cargue.

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

## Lo que quedó anotado para decidir después

**`contratistas` y `proveedores` son casi lo mismo.** El delta creó
`contratistas` como tabla propia del módulo, y el ERP ya tiene `proveedores`
compartido con Compras. Las OS y sus comparativas guardan el proveedor como
**texto**, como en la planilla, y no lo enlazan a `proveedores`: enlazarlos es
una decisión aparte que conviene tomar junto con la de `contratistas`.

**Al portar, revisar `UNFORMATTED_VALUE`.** La app de origen arregló un bug de
fechas en null leyendo Sheets sin formatear. Este ERP tiene su propio lector en
`lib/compras/sheets.ts` y ya se le corrigieron dos cosas parecidas —el día y el
mes dados vuelta, y las celdas ilegibles pisando estados—; conviene mirar los
dos lados antes de portar el de mantenimiento.
