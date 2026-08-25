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
| 3 | OT: **sincronización, filtro por especialidad y parada de sector hechos**; falta registrar realizado e iniciar OT | en curso |
| 4 | Producción semanal | **hecho** |
| 5 | Órdenes de servicio y comparativas | pendiente |
| 6 | Equipos: ficha técnica, tipos, componentes, repuestos | pendiente |
| 7 | Dashboard: KPIs y gráficos | pendiente |

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

Ya se muestra en producción semanal, al lado del nombre del sector. Falta el
dashboard.

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

## Lo que quedó anotado para decidir después

**`contratistas` y `proveedores` son casi lo mismo.** El delta creó
`contratistas` como tabla propia del módulo, y el ERP ya tiene `proveedores`
compartido con Compras. Conviene resolverlo al portar las OT, que es donde se
usa.

**Al portar, revisar `UNFORMATTED_VALUE`.** La app de origen arregló un bug de
fechas en null leyendo Sheets sin formatear. Este ERP tiene su propio lector en
`lib/compras/sheets.ts` y ya se le corrigieron dos cosas parecidas —el día y el
mes dados vuelta, y las celdas ilegibles pisando estados—; conviene mirar los
dos lados antes de portar el de mantenimiento.
