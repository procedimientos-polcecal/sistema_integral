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

## Traer los datos que quedaron en APPRRHH

Mientras las dos apps convivan, la base vieja (Neon/Postgres) sigue siendo la
fuente de verdad. El importador es `scripts/migrate-apprrhh/migrate.mts` y se
puede correr **todas las veces que haga falta**: cada paso reemplaza el rango
que trae, no acumula.

Hace falta el `DATABASE_URL` de la base de APPRRHH (el connection string de
Neon; no está en `.env.local` ni en Vercel a propósito, se pasa por línea de
comandos). Del SdG toma las credenciales de `.env.local`.

```bash
cd scripts/migrate-apprrhh && npm install
```

Primero reconocer qué hay del otro lado:

```bash
DATABASE_URL="postgresql://..." node scripts/migrate-apprrhh/explorar.mjs
```

Después el ensayo, que no escribe nada y lista exactamente lo que va a pasar
—incluidos los empleados que no matchean por legajo y quiénes están marcados
como mensuales:

```bash
DATABASE_URL="postgresql://..." npx tsx scripts/migrate-apprrhh/migrate.mts
```

Y recién cuando el ensayo cierre:

```bash
DATABASE_URL="postgresql://..." npx tsx scripts/migrate-apprrhh/migrate.mts --apply
```

### Qué trae, en orden

1. **Modalidad de pago** — `Employee.modalidadPago` → `empleados.modalidad_pago`.
   Es la forma de marcar los mensuales sin decidirlo a mano: si están
   clasificados en APPRRHH, vienen de ahí. Si la base vieja no tiene la columna
   (es anterior a su migración del 31/07), el paso se saltea y quedan todos en
   jornal.
2. **Fichadas** — `TimeRecord` → `fichadas`, reemplazando el rango completo de
   fechas que trae el archivo, por empleado.
3. **Ausencias y vacaciones** — `Absence` → `ausencias` (**todas**, incluidas
   las de tipo Vacaciones) y `VacationPeriod` → `vacaciones`, rearmando el
   vínculo `ausencia_id`. A una ausencia de Vacaciones sin período que la apunte
   se le deriva uno, para no perder el descuento del balance.
4. **Correcciones a mano** — los `DailyCalculation` con `horasManual = true`
   entran como `horas_manual = true`, así el recálculo no los pisa.
5. **Recálculo** — de todo el padrón activo sobre el rango completo, que es lo
   que regenera `calculos_diarios` y los francos compensatorios.

Los francos no se copian: se regeneran solos en el paso 5, porque salen de los
domingos y feriados trabajados.

### Ojo con esto

**Lo cargado a mano en el SdG dentro del rango importado se pierde.** Los pasos
2 y 3 borran y reinsertan. Mientras Karen siga cargando en la app vieja está
bien; el día que se corte y se empiece a cargar sólo acá, este script no se
corre más.

**El match es por legajo.** Un legajo que exista en APPRRHH y no en el SdG queda
afuera y el dry-run lo lista en `SIN MATCH`. Hay que revisar esa lista antes de
aplicar.

**Los pasos 1 y 3 no se probaron contra la base real**, porque se escribieron
sin acceso al `DATABASE_URL` de Neon. Se pusieron detrás de la detección de
columnas y del dry-run justamente por eso: el ensayo tiene que mostrar números
que cierren antes de aplicar.

### Corrida del 27/08/2026

Se importó todo desde Neon. Números finales, verificados contra la base:

| | |
|---|---|
| Empleados matcheados por legajo | 70/70, sin faltantes |
| Modalidad de pago | 12 mensuales, 58 jornal |
| Fichadas (2026-06-30 → 2026-08-26) | 2877 |
| Ausencias (2026-07-01 → 2026-09-04) | 105 |
| Períodos de vacaciones | 19 (11 de `VacationPeriod` + 8 derivados), 12 vinculados a su ausencia |
| Días corregidos a mano por Karen | 931 |
| Recálculo | 69 empleados activos |

El SdG estaba bastante atrasado: tenía 1416 fichadas contra 2877, y 426
correcciones manuales contra 931.

**Un bug que apareció acá y quedó arreglado.** El borrado previo de vacaciones
estaba acotado a los empleados con ausencias en APPRRHH. Un empleado con período
de vacaciones y ninguna ausencia (las vacaciones cargadas a mano allá) conservaba
su fila vieja del SdG y el import le agregaba una segunda: PC_125 y PS_021
quedaron con 28 días en vez de 14. Ahora el borrado cubre la unión de los dos
conjuntos, y se volvió a correr el import para limpiarlo. Verificado: 0
solapamientos entre períodos del mismo empleado.

**Los 8 períodos derivados quedaron en año 2026** (decisión tomada: se corrigen
a mano). Ojo que los 11 períodos explícitos de APPRRHH están todos en 2025 —son
vacaciones adeudadas—, así que lo más probable es que esos 8 también vayan a
2025. Son PS_015 (6 días de julio) y PS_019 (2 días), y se cambian desde la
pestaña Vacaciones de su ficha, que tiene selector de año.

## Rendimiento y el corte de las 1000 filas (27/08/2026)

Al acelerar la carga de las pantallas apareció un problema de datos más grave
que el de velocidad, y conviene tenerlo presente para cualquier consulta nueva.

### PostgREST corta en 1000 filas, y no avisa

`db-max-rows` está en 1000. Una consulta que devuelve más recibe las primeras
1000 **sin error**, así que el código suma sobre datos incompletos y muestra un
número que parece razonable. En este módulo se cruza el límite enseguida:
`calculos_diarios` tiene una fila por empleado y por día, así que con ~70
empleados dos semanas ya son más de 1000 y un año son 14.352.

Lo que estaba mal, medido contra la base:

| Pantalla | Veía | De | Efecto |
|---|---|---|---|
| Dashboard, top de tardanzas del mes | 1000 | 1863 | informaba 103 tardanzas y 455 retiros; son 232 y 792 |
| Analítico del año | 1000 | 14.352 | calculaba sobre el 7% de los datos |
| Export de fichadas (un mes) | 1000 | 1275 | bajaba el Excel incompleto |
| Planilla general | 1000 | 1863 | liquidaba sobre la mitad de los días |

**Regla para lo que venga:** cualquier consulta que barra el padrón va con
`traerPaginado` (`lib/rrhh/paginado.ts`). Necesita un orden estable —se ordena
por `id`— porque sin eso las páginas se solapan o saltean filas.

### El recálculo, en lote

El recálculo lo dispara casi toda pantalla antes de leer. Recalcular el padrón
tardaba 11,3 s y hacía 639 consultas para 69 empleados y 27 días; de esas, 276
eran la misma consulta repetida 69 veces (config, feriados, turnos, la ficha).
Ahora es una función en lote: **3,9 s y 16 consultas**.

Los tres gráficos del dashboard hacían una consulta por sector (~15 cada uno);
ahora traen el período completo en una y agrupan en memoria.

### Cómo se validó, y un accidente en el camino

El motor de cálculo es lo más delicado del módulo, así que la equivalencia se
probó contra datos reales: se guardaron las 1863 filas de agosto escritas por
el motor viejo, se recalculó con el nuevo y se comparó campo por campo. **0
diferencias**, francos sin duplicar.

Esa misma prueba atrapó un bug del refactor antes de que quedara: la primera
versión no paginaba, así que la lectura de `calculos_diarios` existentes se
cortaba en 1000 y ~930 días con `horas_manual` no se detectaban como manuales
— el recálculo pisó las correcciones a mano de Karen. Se restauró corriendo el
import de nuevo (Neon las tiene todas, con `extras_validadas` y
`validado_por_id`) y se borraron los 7 francos que la corrida mala había
generado, identificados por su `created_at`. **Moraleja: cualquier cambio al
motor se valida con una comparación campo por campo contra un snapshot, no con
los tests unitarios, que son de funciones puras y no ven la capa de base.**
