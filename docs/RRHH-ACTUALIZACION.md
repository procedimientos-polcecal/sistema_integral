# RRHH — al día con APPRRHH

El módulo RRHH de este ERP es un port de `delfinapuch3/APPRRHH` (Express +
Prisma + Vite React) reescrito contra Next.js + Supabase. La app de origen
sigue viva, así que cada tanto hay que traer el delta.

Este documento deja el relevamiento de la última pasada y cómo se hace la
próxima.

## Cómo relevar el delta

El port original quedó estructurado 1:1 con la app de origen, así que el mapeo
es directo:

| En APPRRHH | Acá |
|---|---|
| `server/src/routes/<x>.ts` | `app/api/rrhh/<x>/route.ts` |
| `server/src/engine/`, `server/src/lib/` | `lib/rrhh/`, `lib/rrhh/engine/` |
| `web/src/pages/<X>.tsx` | `app/(app)/rrhh/<x>/<X>Client.tsx` |
| `server/prisma/migrations/` | `supabase/migrations/` (SQL a mano, en castellano) |
| Prisma `Employee.campo` | `empleados.campo` (núcleo) o `rrhh_empleados_datos.campo` |

**Ojo:** no alcanza con mirar los commits nuevos de APPRRHH. Varios fixes se
portaron acá antes de estar en el `main` de origen (ver `3e591a0`), y otros se
resolvieron distinto. Hay que comparar el código, no el historial. En la pasada
de agosto 2026, de los 14 commits nuevos de APPRRHH **7 ya estaban acá** (son 5
features, porque varios commits de origen tocan la misma).

## Pasada de agosto 2026

Base: APPRRHH `542ed23` (14 commits por encima de `b6497ba`, que era hasta
donde llegaba el port anterior).

### Ya estaba portado (no se tocó)

| Feature de APPRRHH | Dónde vive acá |
|---|---|
| Detectar la fila de encabezado real del Excel del reloj | `lib/rrhh/excelImport.ts` |
| Filtrar marcaciones fantasma (≤5 min de la anterior) | `lib/rrhh/excelImport.ts` |
| Marca colgada: reingreso rápido (≤30 min) vs turno distinto | `lib/rrhh/excelImport.ts` |
| Corregir normales / extra 50% / extra 100% por separado | `app/api/rrhh/asistencia/horas-manual`, `components/rrhh/FichadaEditModal.tsx` |
| Importar no duplica: dedup en el archivo + reemplazo del día | `app/api/rrhh/fichadas/import/confirm` |

### Portado en esta pasada

| Feature | Qué cambió |
|---|---|
| **Umbral fijo de hora extra (15 min)** | `lib/rrhh/engine/recalcular-puro.ts`. Antes el umbral para acreditar tiempo de más era el margen de tolerancia del turno; ahora son 15 minutos fijos, independientes de ese margen (que sigue rigiendo tardanza y retiro anticipado). Sin esto, un turno con tolerancia 5 acreditaba como hora extra 10 minutos que podían ser imprecisión del reloj. |
| **Modalidad de pago (jornal / mensual)** | Columna nueva en `empleados`, editable en el alta y en la ficha, y filtro en la planilla general. |
| **Vacaciones vinculadas a la ausencia** | Cargar una ausencia con motivo "Vacaciones" ahora pide el año correspondiente y crea/actualiza/borra su período de vacaciones. Antes había que cargarlo dos veces (una como ausencia, otra como período) o el balance quedaba mal. |
| **Vacaciones de cualquier año en la ficha** | Selector de año para el balance, y las tablas listan todos los períodos sin importar el año (vacaciones adeudadas de años anteriores). |
| **Rango de fechas en el Dashboard** | Los tres gráficos por sector pasan de un selector de período por gráfico (mes / 7 / 15 / 30 días) a un único `desde`–`hasta` compartido. Las tarjetas de hoy y los Top 10 siguen igual. |
| **Francos: filtro por fecha y eliminar** | `desde`/`hasta` sobre `fecha_generado` en el listado y en el export, más borrado con confirmación. |
| **Planilla general en pantalla** | Botón "Ver planilla" que muestra la tabla sin bajar el Excel, con dos columnas nuevas: horas de vacaciones y horas de enfermedad. |

### Decisiones

**`modalidad_pago` va en `empleados` (núcleo), no en `rrhh_empleados_datos`.**
Es del mismo grupo que `valor_hora_normal` y `horas_teoricas_diarias`, que ya
están ahí. Así la planilla filtra por modalidad sin joinear una tabla dispersa,
y el `not null default 'JORNAL'` cubre a todo el padrón existente.

**El período de vacaciones cuelga de la ausencia, no al revés.**
`vacaciones.ausencia_id` es único y `on delete cascade`: borrar la ausencia
borra su período. Los períodos cargados a mano desde la pestaña Vacaciones
tienen `ausencia_id` en null y no los toca nadie. Es el mismo diseño que
APPRRHH (`VacationPeriod.absenceId`).

**Las horas de vacaciones y enfermedad se calculan, no se guardan.**
Esos días no generan horas normales en `calculos_diarios`, así que la planilla
las deriva: días del período que se superponen con el rango × horas teóricas
diarias del empleado. Para enfermedad se cuentan solo días hábiles y sábados
(domingos y feriados no suman), igual que en la app de origen.

**La planilla general recalcula en lote.**
`calcularPlanillaGeneral` (en `lib/rrhh/planillaGeneral.ts`) usa
`recalcularSectorPeriodo(null, …)` y trae los datos de todo el padrón en cinco
consultas, en vez de repetir varias por empleado. Con ~70 empleados, la versión
secuencial tardaba minutos. La usan tanto el endpoint JSON como el de Excel.

## Estado al 27/08/2026: al día

APPRRHH está en `542ed23` (24/08/2026), sin nada por encima, y una sola rama.
No hay delta pendiente.

La migración `038_rrhh_al_dia_con_apprrhh.sql` **ya está aplicada** en Supabase
y verificada contra la base:

- `empleados.modalidad_pago` responde; el `default 'JORNAL'` alcanzó a los 69
  empleados activos, ninguno quedó en null. Si alguien tiene que ser mensual,
  se marca a mano desde la ficha.
- `vacaciones.ausencia_id` responde, y el embed
  `ausencias → vacaciones!vacaciones_ausencia_id_fkey` funciona: PostgREST
  recargó su schema cache y lo resuelve como **uno-a-uno** (devuelve objeto, no
  array), que es lo que el `unique` tenía que garantizar.
- Las tres consultas de la planilla (vacaciones superpuestas, ausencias por
  enfermedad, feriados del período) responden.

Lo que **no** se verificó: las pantallas nuevas renderizando con datos reales.
Requiere sesión iniciada. Están cubiertas a nivel base, tipos, tests y
compilación (las seis rutas de RRHH responden 307 al login, sin 500), pero
nadie las vio andar todavía. Pendiente para la próxima vez que se entre a la
app: "Ver planilla" en Liquidaciones, el campo de año en Ausencias y el filtro
de fechas en Francos.

## Deuda que quedó

Al portar, el cálculo de horas de vacaciones y enfermedad de la planilla salió
sin tests. Se cubrió después (`a40fe5e`, `lib/rrhh/planillaGeneral.test.ts`, 13
casos sobre `diasSuperpuestos` y `diasHabilesSuperpuestos`). El resto de
`calcularPlanillaGeneral` —el armado de las filas y los montos— sigue sin
cobertura: se ejercita solo abriendo la pantalla.
