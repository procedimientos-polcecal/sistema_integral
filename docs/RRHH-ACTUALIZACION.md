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

## El umbral de hora extra pasó de 15 a 30 minutos (17/09/2026)

A pedido: `UMBRAL_EXTRA_MINUTOS` en `lib/rrhh/engine/recalcular-puro.ts` era 15
y pasó a 30 (0,5 horas), y las comparaciones pasaron de estrictas (`>`, `<`) a
inclusivas (`>=`, `<=`) para que el límite mismo cuente — un turno que termina
a las 16 acredita hora extra desde que salió 16:30, no desde 16:15 ni recién
en 16:31.

**Esto es una divergencia deliberada con APPRRHH**, que es donde nació este
umbral (fijo en 15, ver la pasada de agosto arriba) y que puede seguir en 15
del otro lado. Si una futura pasada de sincronización ve el código de origen
con 15, no es una regresión de acá: es un pedido posterior, y el valor de acá
es el que rige.

El recálculo del importador tomaba el rango de los datos, y las ausencias
suelen estar cargadas hacia adelante: había una licencia que terminaba el
04/09. Para un día que todavía no pasó no hay fichadas, así que el motor lo
marcaba como falta sin clasificar. Resultado: **460 faltas fantasma** entre el
28/08 y el 04/09, unas 67 por día, una por empleado activo.

No se veían en pantalla porque el filtro por defecto corta en hoy, pero
estaban en la base y aparecían solas el 1 de septiembre.

Se borraron las 460, verificando antes que ninguna tuviera horas, franco,
validación, corrección manual u observaciones (0 las tenían). Se conservaron
las 10 ausencias futuras ya clasificadas y las 82 filas no ausentes
(vacaciones, domingos). El total de faltas sin clasificar pasó de 8697 a 8237.

Y se arregló la causa: **el importador ya no recalcula más allá de hoy.** Si
los datos llegan más lejos, lo avisa y corta igual.

Ojo que el backlog real siguen siendo las **8237 faltas sin clasificar desde
febrero**, que vienen de la app vieja y nadie clasificó nunca. En el mes en
curso son 130, que es lo manejable. Mientras eso esté sin clasificar, el
ausentismo del Analítico (~70%) va a seguir siendo un número sin sentido:
está contando como ausencia cada día que nadie clasificó.

## El desfasaje de 3 horas en las marcaciones (27/08/2026)

Comparando la ficha de un empleado lado a lado con APPRRHH aparecieron todas
las marcaciones **+3 horas** en el SdG: donde la app vieja mostraba
`08:03-15:51`, acá decía `11:03-18:51`. Y no era sólo cosmético: con los
horarios corridos ningún turno matcheaba, así que salían badges de "Tardanza"
y "Retiro anticipado" que no correspondían y las horas daban 7,8 u 8,1 en vez
de 8,0.

**La causa.** APPRRHH guarda los horarios en columnas `timestamp WITHOUT time
zone`, y lo que hay ahí es **UTC**: la app convierte a hora de Argentina recién
al mostrar. `node-pg`, en cambio, interpreta esas columnas en el huso del
proceso, así que corriendo el importador desde Buenos Aires una marca de las
11:03 se leía como 11:03 ART = 14:03 UTC y entraba tres horas adelantada.

**El arreglo.** El importador trae los timestamps como texto (`::text`) y los
interpreta explícitamente como UTC. Las fichadas cargadas a mano en el SdG
nunca tuvieron el problema: su convención ya era la correcta.

### Cómo quedó, verificado contra Neon

| | |
|---|---|
| Fichadas comparadas una por una | 2877 vs 2877, **0 diferencias** |
| Cálculos diarios comparados | 4162 |
| Iguales | 4141 |
| Diferencias sólo por redondeo | 456 (el SdG usa `numeric(5,2)`, APPRRHH float) |
| **Diferencias reales** | **21** |

Las 21 se explican todas:

- **8 días** (PS_015, PS_019): en APPRRHH esos días son `ausente=true` tipo
  VACACIONES; acá son `ausente=false` porque el import les derivó un período de
  vacaciones y en este modelo la vacación gana sobre la ausencia. Es la
  consecuencia esperada de derivar los períodos huérfanos.
- **3 días** (PS_050, sábados): sector renombrado, ver abajo. **Corregido.**
- **~10 días** con diferencias de minutos: son días que APPRRHH todavía no
  recalculó desde su cambio del umbral de hora extra (`542ed23`, 24/08). Al
  comparar `DailyCalculation` guardados se compara *cuándo recalculó cada
  lado*, no el algoritmo.

### El sector renombrado

Al unificar el padrón en el núcleo, algunos sectores tomaron el sufijo
`(RRHH)` para no chocar con los homónimos de Mantenimiento. Pero
`SECTORES_LUNES_A_VIERNES` matchea por **nombre exacto**, así que `Calidad
(RRHH)` dejó de aplicar la regla y a sus 2 empleados los sábados les figuraban
como falta. Se agregó el nombre nuevo a la lista.

Es el único caso: de los sectores con empleados activos, los demás o matchean
exacto (RRHH, Tesorería, Finanzas, Compras y Pañol, Ventas y Despacho) o
legítimamente trabajan fines de semana.

**Ojo con esto para adelante:** cualquier sector que se renombre desde
Administración deja de aplicar la regla sin que nadie se entere. El
acoplamiento por nombre viene del original y sigue siendo frágil.

## Las marcaciones entran por la API de Lenox (07/10/2026)

Hasta esta fecha las marcaciones del reloj llegaban así: alguien bajaba un
`.xlsx` del servicio de Lenox, lo subía a `/rrhh/fichadas`, mapeaba columnas y
confirmaba. Medido el 06/10/2026 contra producción, **la fichada más reciente
era del 30/09**: seis días sin cargar, y una numeración de archivos
(`Reporte_Marcaciones (63)`, `(69)`, `(71)`) que contaba sola que la carga iba a
los tirones. La liquidación dependía de que alguien se acordara.

Desde ahora entran solas, por la API de Lenox, con un **cron diario** y un
botón **"Traer de Lenox"** en la misma pantalla. **El Excel se quedó, plegado,
como respaldo**: si Lenox se cae, cambia la clave, o hace falta cargar un
período viejo largo de un tirón, el camino sigue estando.

Los porqués del diseño están en el
[spec](superpowers/specs/2026-10-07-rrhh-marcaciones-desde-lenox-design.md) y
el paso a paso en el
[plan](superpowers/plans/2026-10-07-rrhh-marcaciones-desde-lenox.md); lo que
sigue es lo que hay que saber antes de tocar esto, que no se deduce del código.

### Qué hay y dónde

| | |
|---|---|
| `lib/rrhh/lenox/cliente.ts` | HTTP puro y tonto: la clave, el tope de 7 días por pedido, el `204`, el `429`. No interpreta nada |
| `lib/rrhh/lenox/agrupar.ts` | Marcaciones sueltas → días por legajo, **incluidos los días vacíos** del rango |
| `lib/rrhh/lenox/sincronizar.ts` | Orquesta: trae, agrupa, aplica, coteja el padrón y deja el lote anotado |
| `lib/rrhh/fichadas/decidir.ts` | **Puro**: qué insertar, qué borrar, qué saltear y por qué. Donde viven las tres protecciones |
| `lib/rrhh/fichadas/aplicar.ts` | La capa que escribe. **La usan los dos caminos de carga** |
| `app/api/cron/rrhh-lenox-sync` | El cron, `30 10 * * *` (7:30 de acá) |
| `POST /api/rrhh/fichadas/lenox/sincronizar` | El botón |

**Lo único que cambió es de dónde salen las marcaciones.** La lógica que las
interpreta —`reconciliarTokens`: la marca fantasma, el turno que cruza la
medianoche, la fichada que quedó abierta en un lote y se cierra con el
siguiente— es la misma de siempre, con sus 4.672 fichadas de kilometraje, y no
se reescribió. Lo que sí se hizo fue sacar el alta de dentro de la ruta de
import (233 líneas, sin un solo test) a `aplicar.ts`, para que Lenox y el Excel
no tuvieran dos altas que se fueran separando. El que casi no se usa es el que
se pudre sin que nadie lo note.

La clave se carga como `LENOX_API_KEY`: ver
[VARIABLES-VERCEL.md](VARIABLES-VERCEL.md). **Al 08/10/2026 está en
`.env.local` y falta en Vercel**, así que en producción el cron responde
"omitido" hasta que se cargue.

### Las tres protecciones, y por qué la unidad es el día

La sincronización corre sola, y eso vuelve peligroso algo que antes era
inofensivo: **editar una fichada no cambia su `origen`**. El `PUT` toca las horas
y deja la fila en `IMPORTADO`, y la carga borra todas las `IMPORTADO` del día
antes de insertar. Con el Excel casi no mordía, porque quien lo sube sabe que
está pisando un período. Un cron pisa sin que nadie se entere, que es la peor
forma de todas.

La primera idea fue un tercer valor `CORREGIDO` en el enum `origen_fichada`, y
**no alcanza**, por dos razones:

1. **La sincronización no reemplaza fichadas: reemplaza días.** Si se protege la
   fila corregida pero se reinserta el día, queda la corregida *y* vuelve la
   importada: el día duplicado.
2. **Borrar no deja rastro.** El caso concreto: una marca fantasma a 40 minutos
   de la anterior (el filtro sólo descarta las de 5 minutos o menos) arma un
   turno falso de 40 minutos. Alguien lo borra, y mañana el cron lo vuelve a
   crear. Todos los días, para siempre. Con el enum no se arregla, porque la fila
   que lo probaría ya no existe.

Por eso la protección es por **(empleado, día)** y se guarda aparte, en
`rrhh_dias_corregidos`. Son tres, y las tres miran el día de entrada:

- **El día que tocó una persona.** Lo escriben los tres verbos que significan
  "alguien tocó este día": el alta manual (`POST /api/rrhh/fichadas`) y la
  edición y el borrado (`PUT` y `DELETE` de `fichadas/[id]`). Cubre los tres con
  un solo mecanismo, y el campo `accion` (`creada`, `editada`, `borrada`) no
  decide nada: está para que cuando alguien pregunte "¿por qué este día no se
  actualiza?" la respuesta esté escrita. **Se libera sacándole la marca** a ese
  día.
- **El período ya liquidado.** Un día dentro de una `liquidaciones` en estado
  `CERRADA` no se toca. Protege otra cosa: que un cambio tardío en Lenox le mueva
  las horas a un mes ya pagado. Se libera reabriendo la liquidación.
- **El aviso de divergencia.** Saltear en silencio es casi tan malo como pisar.
  Cuando un día se saltea por cualquiera de las dos razones, se compara lo
  guardado contra lo que trae Lenox y, **si difieren**, sale un aviso:

  ```
  Legajo PC_204, 2026-10-02: corregido a mano (07:58–16:03),
  Lenox ahora trae 08:12–16:03
  ```

  **Nunca pisa.** Es la misma regla que gobierna los enlaces por texto libre en
  las planillas: cuando no hay certeza, se informa y decide una persona.

**La corrección manual gana siempre**, y eso es un riesgo asumido, no un olvido:
si alguien corrige un día a mano y después se arregla la marcación en Lenox, la
local sigue tapando a la buena hasta que una persona lea el aviso y actúe. La
alternativa es que el sistema le pise el trabajo a quien corrigió.

**Otro riesgo asumido: las protecciones miran el día de entrada, no el de
salida.** Un turno que entra en un día libre y sale en un día dentro de una
liquidación cerrada se aplica igual, y el recálculo reescribe las horas de ese
día cerrado. Para que ocurra hace falta que el período posterior se haya
liquidado **antes** que el anterior; con las liquidaciones cerradas en orden, el
borde mensual no lo dispara. Se evaluó cerrarlo y se descartó: no tiene una
respuesta buena (si el día de salida está protegido, saltear el turno entero deja
el día de entrada sin reemplazar, y ése no estaba protegido) y cuesta unas 25
líneas y seis tests. El síntoma, si alguna vez aparece, serían horas que cambian
en un mes ya liquidado, en alguien con turno nocturno, el día siguiente a un día
no liquidado.

### La ventana del cron es de 7 días

El cron mira **los últimos 7 días contando hoy**, que es también el tope por
pedido de la API: una sola llamada de marcaciones. El tope lo impone el servidor
—con 8 días devuelve `400` y *"La cantidad de dias entre las fechas desde y hasta
no debe superar los 7 días"*—, no es una precaución nuestra.

**Riesgo asumido:** si nadie mira durante más de una semana, **lo más viejo que 7
días no se recupera solo**: hay que usar el botón. Se eligió 7 sobre 14 a pedido,
y como el hueco medido al escribir esto era de seis días, el margen es de uno. Si
vuelve a pasar, subir `DIAS_DEL_CRON` en `lib/rrhh/lenox/rango.ts` es cambiar una
constante y sumar una llamada por corrida.

Hay un segundo riesgo del mismo tamaño y más callado: **si el `insert` falla a
mitad de los lotes de 500, el día ya fue borrado y queda vacío o a medias.** Se
cura en la próxima corrida —el cron, el botón o el Excel—, salvo que el día ya
haya salido de la ventana de 7. Invertir el orden (insertar antes de borrar) se
descartó: un borrado que falla dejaría el día duplicado, que es peor, porque esas
horas se pagan. El error dice cuántas filas quedaron insertadas, y el lote queda
anotado con eso.

### El límite de llamadas de Lenox

**Lenox limita las llamadas y no dice cuál es el límite.** Midiéndolo el
07/10/2026 bastaron **unas doce seguidas** para recibir un `429`. La respuesta
no trae `Retry-After`, ni ningún header de límite, ni cuerpo
(`content-length: 0`), y **tardó más de veinte minutos en levantarse**: sondeando
cada 20 segundos, a los 7 minutos seguía bloqueada.

De ahí salen tres decisiones que conviene no deshacer sin haberlo medido de nuevo:

- **No se reintenta un `429`, nunca.** Sin `Retry-After` cualquier espera sería
  inventada, y lo más probable es que **sondear mantenga vivo el bloqueo**. Un
  reintento automático sobre esta API no se recuperaría nunca: se quedaría
  girando. Se corta, se anota en `sincronizaciones` con el texto de Lenox, y se
  le dice a la persona que espere. El botón además **queda bloqueado aunque se
  recargue la página** (lo decide `bloqueoPorUltimaSync` en
  `lib/rrhh/lenox/pantalla.ts`, mirando la última corrida anotada), porque el
  bloqueo es de la cuenta y no de quien apretó, y una corrida del cron que
  recibe un `429` también lo deja bloqueado. **El bloqueo del botón es de 15
  minutos y lo medido fue más de veinte**: se eligió 15 porque no hay un número
  mejor, y si Lenox sigue rechazando al terminar, el botón se vuelve a bloquear
  con el siguiente `429`. Es un riesgo asumido, y la señal para subirlo es que
  eso pase seguido.
- **El botón acepta como máximo 31 días.** El cliente ya parte el rango en
  ventanas de 7, así que no es un límite de la API: es para que un clic no gaste
  de golpe las llamadas que hay. **Cada 7 días de rango es una llamada**, más una
  fija de `GetEmpleados`: 31 días son 5 ventanas más el padrón, seis llamadas.
  Estuvo en 62 un rato (diez llamadas, demasiado cerca de las doce que ya
  bastaron para el bloqueo) y se bajó. El caso de uso real es traer un mes; para
  algo más largo, en dos veces.
- **El cron hace dos llamadas por corrida**, una de marcaciones y una de
  empleados para el cotejo. Está muy lejos del límite. El cotejo no suma una
  tercera: reusa el padrón del SdG que ya se leyó para enlazar los legajos.

Otras dos cosas de la API que **no estaban en la documentación** y que rompen el
cliente si se olvidan:

- **Un rango sin marcaciones devuelve `204` con el cuerpo vacío.** `res.ok` es
  `true` para un 204 y `res.json()` sobre un cuerpo vacío lanza: un fin de semana
  largo habría roto el cron. El cliente trata el 204 como "cero filas" antes de
  intentar parsear.
- **No hay paginación real.** `FilasExcluidas` es un offset, pero devuelve todo lo
  que queda, no una página: 7 días son 735 filas de 62 legajos en una sola
  llamada (medido el 07/10/2026). La paginación del cliente queda como red, con
  el `mensaje` de la respuesta (`"Se muestran todos los resultados"`) como
  camino rápido para no gastar una llamada de más.

Y una de contexto: `tipoMarcacion` trae `"Por Reloj"` y `"GeoCerca"`, no los
valores de la doc. **Hay gente fichando por geocerca desde el teléfono**, así que
una fichada sin reloj asociado (`reloj` es `"porteria"` o `null`) no es un error.

### Dos caminos de carga, y no se comportan igual

Los dos pasan por `aplicarDias`, así que dedup, recálculo y borrado son los
mismos. **Lo que difiere es a propósito:**

| | Lenox (cron y botón) | Excel |
|---|---|---|
| Día corregido a mano | **Lo protege**: no lo toca y avisa si difiere | **Lo pisa** |
| Liquidación `CERRADA` | Frena | Frena |
| Quién decide | Nadie: corre solo | Quien sube el archivo |

El Excel no protege los días corregidos porque quien sube un archivo **elige
pisar un período**: es un gesto deliberado, con el archivo a la vista. El cron no
elige nada, así que tiene que ser él quien se frene. Es `protegerCorregidos` en
`aplicarDias`: `false` en la ruta del Excel y `true` en la sincronización.

La **liquidación cerrada frena a los dos**, y eso es un cambio de
comportamiento del Excel: antes no miraba si el período estaba liquidado y podía
mover las horas de un mes ya pagado. Efecto secundario buscado: `insertados` ya no cuenta los
turnos de días dentro de una liquidación cerrada.

**Un modo del Excel no pasa por la reconciliación de marcas.** El archivo
"separado" trae una columna de entrada y otra de salida: el emparejamiento ya
viene dado, y pasarlo por `reconciliarTokens` —que existe para *inferir* cuál es
cuál— tiraba información que el archivo entregaba. Se vio al correrlo: una
entrada sin salida se cerraba con la entrada de otra fila, y una salida a 5
minutos de la entrada se descartaba como fantasma. Por eso `decidir.ts` recibe
una unión (`{ tipo: "marcas" }` / `{ tipo: "turnos" }`) y no un flag suelto, y
desde la bifurcación todo es común.

### Qué es un error y qué es un pendiente

Un lote de Lenox (`rrhh_import_batches`, con `Lenox API · 30/09 → 06/10` como
nombre y `usuario_id` nulo cuando lo corrió el cron) lleva dos listas, y el
criterio que las separa es uno solo:

> **Un error es algo que hizo que un dato no se cargara.** Todo lo demás es un
> pendiente.

Es lo que evita que la pantalla arranque cada día con cincuenta y pico de
"errores" que nadie puede hacer desaparecer. Ya pasó cuatro veces en este módulo,
y es la razón por la que existe el aviso agregado de fichadas abiertas viejas:

- **Error**, y cuenta en `cantidad_errores`: un legajo de Lenox que el SdG no
  tiene (el alta que no se cargó: las marcaciones de esa persona no entraron),
  filas ilegibles que se descartaron, un rango de más de dos días sin una sola marcación
  (casi seguro una falla de Lenox, que sin este aviso se reportaría como éxito), un día
  salteado cuyo contenido **difiere** de lo que trae Lenox.
- **Pendiente**, va al detalle y **no** al conteo: las fichadas abiertas viejas
  (al 07/10/2026 son 54, de 23 empleados, todas errores de carga históricos, y
  sin el agregado eran hasta 23 líneas fijas en cada corrida); una baja de Lenox
  que el SdG tiene activa; un activo del SdG que no existe en Lenox
  (gerencia, probablemente de forma permanente y legítima); y que el cotejo del
  padrón no haya podido correr.

El último caso es el que más enseña: **un día salteado que no cambió nada deja de
ser un aviso.** Un día corregido a mano se saltea en *cada* corrida, para siempre,
así que si cada una sumara un renglón por cada día corregido que exista, serían
avisos que nunca dejan de salir. Sólo se avisa cuando lo que trae el reloj
**difiere** de lo guardado, que es el único caso en que hay algo para decidir. El
conteo de días sin tocar sigue estando en el resumen.

`ok: true` en la corrida **también cuando hay avisos o pendientes**: son cosas
que alguien tiene que mirar, no una corrida que falló. Mezclarlos haría que un día
con una fichada abierta se vea igual que un día con Lenox caído. Lo que sí es un
fallo se anota en `sincronizaciones` (`modulo: "rrhh"`,
`recurso: "lenox-marcaciones"`) **con lo que dijo Lenox sin traducir**, que es lo
que alimenta el cartel de "actualizado hace…".

### Qué falta verificar

**Un día de datos reales de Lenox comparado contra el Excel del mismo día,
fichada por fichada.** Es la prueba que cierra esto —es lo que se hizo el
27/08/2026 con el desfasaje de 3 horas, y lo que lo dejó resuelto de verdad— y
**no se hizo** al escribir esto: el 07/10/2026 se agotó el límite de llamadas
midiendo la API, y el código del cliente se escribió sobre esas mediciones, no
sobre una corrida completa. Lo que hay son 204 tests sobre las funciones puras
de `lib/rrhh/lenox/` y `lib/rrhh/fichadas/` (08/10/2026), y esos no prueban que
la API siga contestando lo que contestó.

La primera corrida real conviene que sea el botón con **un solo día** y con el
Excel de ese día a mano: dos llamadas, y una comparación que se puede hacer a
ojo. Sólo después tiene sentido dejar correr al cron.

Lenox tiene 73 empleados y el SdG 70 (con 2 marcados con `fechaBaja` en Lenox,
al 07/10/2026), así que el cotejo del padrón va a tener algo que decir desde la
primera corrida: es lo que se espera, no una falla.

**Queda fuera, a propósito:** `FechaJornada` y `GetDiasTrabajados` (cambiaría un
motor con tests por uno sin tests, para resolver algo ya resuelto), `precioHora`
(el valor hora vive en `rrhh_empleados_datos` desde el 22/09/2026 y esa decisión
no se revisa acá), y `GetLicencias`, `GetVacaciones` y `GetFeriados` (el SdG ya
tiene `/rrhh/ausencias`, `/rrhh/vacaciones` y `/rrhh/feriados` con datos propios,
y traerlos abre la pregunta de cuál de los dos manda).

---

## El margen de tolerancia pasó de 20 a 30 minutos (08/10/2026)

Las seis jornadas del catálogo (`jornadas`) tenían `tolerancia_minutos = 20` y
ahora tienen 30. Es un cambio de **configuración**, no de código: se hace desde
`/rrhh/turnos` y se deshace igual.

### Qué hace ese número, que no es obvio

El margen no es sólo para marcar tardanza. `ajustarFichadasPorTurno`
(`lib/rrhh/engine/recalcular-puro.ts`) **acredita desde el horario pactado
cuando la marca cae dentro del margen**: una entrada a las 19:46 en el turno
20–04 se acredita 20:00, y una salida a las 03:42 se acredita 04:00. La
marcación real **no se toca** — lo que cambia es lo que se liquida.

Pasado el margen, se cuenta el horario real y se marca tardanza o retiro
anticipado. Y para el lado del empleado hay un umbral aparte y fijo,
`UMBRAL_EXTRA_MINUTOS = 30`: quedarse menos de media hora de más no acredita
hora extra, porque puede ser imprecisión del reloj.

Con el margen en 30, el comportamiento es exactamente éste:

| Turno de 8 horas, real | Se liquida | Señal |
|---|---|---|
| 7h31 (salió 29' antes) | **8h** | — |
| 8h29 (salió 29' después) | **8h** | — |
| 7h25 (salió 35' antes) | 7h25 | retiro anticipado |
| 8h35 (salió 35' después) | 8h35 | hora extra |

### Por qué se subió

RRHH venía **editando a mano** las salidas de los turnos nocturnos para que
cerraran en 04:00, convencida de que si no lo hacía se pagaban 7h53. **No era
cierto**: se midió el 08/10/2026 contra el 29/09 y de los cuatro turnos
nocturnos de ese día, tres estaban editados a mano y uno no — y los cuatro
liquidaban 8 horas iguales. El trabajo manual no cambiaba nada, salvo
falsificar la marcación real del reloj.

Lo que faltaba de verdad era que **la pantalla mostrara lo acreditado**, porque
sin eso nadie podía saber que el día ya cerraba solo. Eso se agregó en la misma
fecha: la lista de fichadas y el modal de edición muestran, al lado de la marca
real, lo que se acredita y el total.

### Lo que costó, medido antes de aplicarlo

Simulado sobre las 4.637 fichadas cerradas que había:

| | |
|---|---|
| Tramos que cambian | **690 de 4.637** (15%) |
| Horas acreditadas de más | **+283,5 horas** |
| Horas acreditadas de menos | **0** — todo a favor del empleado |
| Días con tardanza | 311 → 225 |
| Días con retiro anticipado | **826 → 218** |

El salto de los retiros anticipados es el que explica casi todo: había 826 días
marcados por gente que se iba entre 20 y 30 minutos antes.

### El riesgo asumido, y lo que NO se hizo

**No se recalculó nada de lo viejo**, a pedido. El criterio nuevo rige para lo
que se calcule de acá en adelante; ninguna liquidación cerrada se movió.

La consecuencia hay que tenerla presente: **un día calculado antes del
08/10/2026 tiene sus horas computadas con el margen de 20**, y si alguien
recalcula ese período ahora, el número va a cambiar. No es un error del
sistema: es el cambio de criterio llegando a un día viejo. Si eso aparece en
una liquidación cerrada, lo que vale es lo que se pagó.

Y la otra, que es del diseño y no de este cambio: **el margen se aplica a cada
punta por separado**, no al total. Alguien que entra 29 minutos tarde y se va
29 minutos antes trabaja 7h02 y se le acreditan 8h, sin ninguna señal. Con el
margen en 20 el regalo máximo era de 40 minutos; con 30 es de una hora. Si eso
molesta, lo que hay que cambiar es la regla —pasar el margen al total— y no el
número.
