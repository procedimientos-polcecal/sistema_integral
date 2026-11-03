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

Las siete features están portadas. **La integración está andando**: verificado
contra la base el 7/09/2026, las cuatro sincronizaciones corren y traen datos.

| Sincronización | Trae | Última corrida |
|---|---|---|
| Órdenes de trabajo | 1.821 | 7/09/2026 |
| Órdenes de servicio | 228 | 7/09/2026 |
| Comparativas | 159 | 7/09/2026 |
| Avisos | 147 | 7/09/2026 |

Los cuatro `GOOGLE_SHEETS_*_ID` están configurados en Vercel —si no lo
estuvieran, la sincronización devolvería un 503 y no 228 filas— y las
migraciones 031 a 035 están aplicadas: `mantenimientos_ejecuciones.work_order_id`,
`ordenes_servicio.proveedor_id`, `sectores.codigo`/`es_de_planta` y
`os_comparativas.equipment_id` responden todas.

El libro "BD Equipos" también se importó: hay 26 tipos de equipo y 398
componentes.

### Lo que sigue faltando

| Falta | Qué se sabe |
|---|---|
| `equipos_repuestos` está **vacía** | La tabla existe y la pantalla la muestra; nunca se cargó ningún repuesto. Puede ser que no haya libro para importar, o que quedó afuera del relevamiento. |
| La ficha técnica está en **15 de 239 equipos** | Es trabajo de relevamiento y no de configuración: se completa recorriendo la planta, y por eso todos sus campos son opcionales. |
| Que las planillas estén compartidas como **editor** | Sin verificar, y **no se puede verificar desde el código**: leer funciona con permiso de lectura. La primera escritura que falle lo va a decir. |

Cada escritura en una planilla es best-effort y avisa qué no se pudo escribir,
así que la app sirve igual mientras eso se resuelve. La excepción es **aprobar
una orden de servicio**, que se rechaza entera si la planilla no la acepta: ver
más abajo.

## Decisiones

**Las OS van aparte de Compras.** Decidido antes de empezar. El delta crea
`ordenes_servicio` y `os_comparativas` propias del módulo, aunque solapen con
`compras_requerimientos` y `compras_cotizaciones`.

Eso sigue valiendo para las **tablas**, pero no para el circuito: desde el
4/09/2026 la **aprobación** de una OS se hace desde Compras → Aprobaciones, que
es quien decide sobre el gasto. Las tablas no se movieron ni se fusionaron con
las de Compras; lo que cambió es desde dónde se decide. El seguimiento —proveedor,
costo, fechas— sigue siendo de Mantenimiento y sigue en su pantalla. Ver
"Aprobar una OS" más abajo.

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
| 5 | Órdenes de servicio y comparativas | **hecho** — y la aprobación pasó a Compras, ver abajo |
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
H descripción · I repuesto · J inicio · K cierre · L (calculada) · M estado ·
N contratista · O horas · P/Q/R operarios · S prioridad · T frecuencia ·
U próxima fecha · V fotos · W observaciones · X observación previa ·
Y fin (estimada)`

La **X se agregó el 16/10/2026** y es la única que no estaba en el origen. Ver
"Por qué una OT todavía no se hizo", más abajo.

### Tres fechas que se confunden, y la Y que llegó el 02/11/2026

Ese día la **J pasó de llamarse «FECHA DE EJECUCIÓN» a «FECHA DE INICIO»** y
apareció la **Y, «FECHA DE FIN»**. Con eso la planilla pasó a tener tres fechas
de trabajo y conviene leerlas juntas, porque dos son estimaciones y una no:

| Columna | Qué es |
|---|---|
| **J — fecha de inicio** | Cuándo se compromete a **empezar**. Estimada. Es la que decide si una OT está atrasada |
| **Y — fecha de fin** | Cuándo se calcula que **termina**. Estimada y **opcional** |
| **K — fecha de cierre** | Cuándo se cerró **de verdad**. No es una estimación |

Tres cosas que no se deducen del código:

- **Por dentro la J se sigue llamando `fecha_ejecucion`**, en la base y en todo
  `lib/mantenimiento`. Es la misma fecha con mejor nombre: renombrar la columna
  habría arrastrado el MTBF, el contraste, el GUT y la programación del taller
  sin cambiar nada de lo que hacen. Lo que sí se renombró es **el nombre que se
  ve**, y vive en un solo lugar —`IMPRESCINDIBLES` de
  [lib/mantenimiento/altaDeOT.ts](../lib/mantenimiento/altaDeOT.ts)— del que lo
  toman los cuatro formularios, el contraste y los avisos.
- **La Y no se guarda en `ordenes_trabajo`.** No hay columna ni migración: la
  fecha de fin viaja del formulario a la planilla y se queda ahí, que es donde
  manda. El día que haga falta verla en el sistema son una columna nueva y
  leerla en `filaDeOrden`.
- **Si el encabezado no trae «FECHA DE FIN», el dato no se escribe y el alta no
  se cae.** Es la regla que ya valía para toda columna que el formulario puede
  no tener, y acá tiene una consecuencia: hasta que esa columna exista en las
  **dos** pestañas del libro de respuestas —`Respuestas de formulario` y
  `Altas del sistema`—, cargar la fecha en la app no deja nada del otro lado.
  El par está fijado con un test en `formulario.test.ts`.

Y del lado de la planilla, la Y del master **no es derrame todavía**: nació
vacía, sin fórmula. Para que traiga lo que cargan las dos pestañas necesita su
propio `QUERY(IMPORTRANGE(...))` en la `Y2`, con la misma forma que la `S2` y
—esto es lo que las alinea— el mismo `ORDER BY Col1`.

**La columna L no es el estado.** Se llama "Column 19" y trae un "Atrasado / al
día" calculado; el estado está en M. Confundirlas daría por atrasada media
planilla.

Estados: `Realizado`, `Atrasado`, `Por hacer`, `En proceso` — el mismo
vocabulario que ya usaba el ERP, así que la traducción portó directo.
Especialidades: `MECÁNICO`, `ELÉCTRICO`, `CIVIL`, `LUBRICACIÓN`.

Un guión suelto en un campo de texto se lee como vacío: es cómo se escribe "acá
no va nada" en una planilla, no un contratista llamado "-".

### El repuesto es **una celda**, y está en dos lugares

Leído de las planillas el 19/10/2026, porque es lo primero que se pregunta al
tocar ese campo y no se deduce del código:

| Dónde | Columna | Quién la escribe |
|---|---|---|
| `Respuestas ORDEN DE TRABAJO` → `Altas del sistema` | **Z** `REPUESTO UTILIZADO` | El SdG, al crear la OT |
| `ORDEN DE TRABAJO` → `OT` (el master) | **I** `REPUESTO UTILIZADO` | **Nadie**: A–J son el derrame del `QUERY(IMPORTRANGE())` |

O sea que escribir "el repuesto en la planilla" es escribir la **Z** del libro de
respuestas; la **I** del master aparece sola y la sincronización la lee de ahí,
**por posición** (índice 8). Una columna insertada antes de la I rompe esa
lectura en silencio.

**Desde el 19/10/2026 el formulario de alta carga los repuestos por renglones**,
cada uno con su cantidad, y se guardan en `ordenes_trabajo_repuestos`. A la
celda va el texto de todos juntos, **separados por punto y coma** desde el
21/10/2026: `2 grillas 2 mm; 4 martillos`. El separador no es decorativo — es
por donde corta `itemsDeRepuesto()` de
[lib/mantenimiento/repuestosDesdeOt.ts](../lib/mantenimiento/repuestosDesdeOt.ts),
el parseo que sacó los repuestos de las 275 OT viejas, así que lo que el
sistema escribe hoy se vuelve a leer igual que lo que escribió la gente a mano.
Hay tests que hacen la vuelta completa en
[repuestosDeLaOT.test.ts](../lib/mantenimiento/repuestosDeLaOT.test.ts).

Era una coma hasta el 21/10/2026, y se cambió a pedido: en la celda un `;` se
ve de lejos y una coma no, porque **adentro de un repuesto ya hay comas**
—"rodamiento 22216, EK"—. `partirRepuesto` ahora corta por las dos, y eso no
cambió la lectura de nada de lo que ya estaba: de las 277 OT con repuesto
escrito, **ninguna tenía un punto y coma**. Y un `;` o una `,` adentro de un
nombre se siguen reemplazando por un espacio, porque los dos partirían ese
renglón en dos al volver a leerlo.

**Se evaluó dejarlos en dos columnas y se decidió que no** (19/10/2026): la
columna de cantidad habría que agregarla en el libro de respuestas —que lo
gobierna Google Forms—, extender el `QUERY` del master, y eso corre las
columnas que la sincronización lee por posición. El detalle por renglón ya vive
en `ordenes_trabajo_repuestos`, que es donde sirve para algo; la celda queda
como lo que es, el renglón que lee una persona.

## Lo que la planilla deja de tener, se borra

Desde el 18/10/2026 las tres sincronizaciones —OT, avisos y órdenes de
servicio— **borran** la fila que la planilla ya no trae. Hasta ese día sólo
traían y pisaban, así que una fila que alguien sacaba de la planilla seguía
viva en el SdG para siempre: el espejo dejaba de ser un espejo y nada avisaba.

La decisión y el cómo viven en [`lib/core/borradoDeEspejo.ts`](../lib/core/borradoDeEspejo.ts),
que es compartido con Compras y es donde están los tests. Acá sólo hace falta
saber cuatro cosas.

**Se borra de verdad, con `DELETE`.** No es una marca: la fila se va. Lo que
cuelga de una OT y qué le pasa, leído de la base el 18/10/2026 con
`node scripts/que-cuelga-de.mjs ordenes_trabajo` —que conviene volver a correr
antes de creerle a esta tabla, porque varias de estas tablas las creó un delta
aplicado a mano y sus `on delete` no están en ninguna migración del repo—:

| Apunta a la OT | Al borrarla |
|---|---|
| `ordenes_trabajo_notas` (por qué no se hizo) | **se borra** en cascada |
| `ordenes_trabajo_repuestos` | **se borra** en cascada |
| `avisos` | **se borra** en cascada, desde la migración `20261018160209` |
| `mantenimientos_ejecuciones` | queda, con el enlace en null |
| `planificacion_diaria_items` | queda, con el enlace en null, desde `20261018161825` |

Las dos decisiones que no se deducen solas:

**El aviso se va con la OT**, a pedido. Conviene saber que **`avisos` espeja su
propia planilla**: si la línea sigue en la hoja AVISOS, la sincronización de
avisos lo vuelve a traer, sin enlace. El borrado es definitivo sólo si también
se sacó de allá.

**El ítem de planificación se queda**, y eso es lo contrario. Porque no es de
la OT: es del plan de un día, que alguien armó y que siguió existiendo, y
borrarlo reescribiría un plan ya pasado. No pierde la referencia —el ítem
guarda `ot_number`, la especialidad, el sector, el equipo y la descripción,
copiados al planificar—: lo único que se pierde es poder navegar a una fila que
ya no está.

Hasta el 18/10/2026 ése estaba en `no action` y **hacía fallar** el borrado,
que con lotes de 200 ids significa tumbar las 200 que viajaran con ella. Hoy no
hay ninguna fila enlazada, así que el cambio no movió un dato: cambia lo que va
a pasar cuando la haya.

**Sólo se borra aquello cuya ausencia prueba algo.** Quedan protegidas la fila
que la app escribió y todavía no exportó —`app_created` con `sheets_row` en
null, hoy una OT— y la que nació después de que leyéramos la planilla. Que no
vinieran en la lectura es lo esperable en los dos casos.

**Hay un freno y salta solo.** Si lo que habría que borrar pasa de 50 filas o
del 10% de la tabla —lo que sea mayor—, no se borra nada y se dice por qué. El
caso que lo justifica ya pasó: el 13/10/2026 una planilla recalculando devolvió
2 filas de 623, y con esto encendido y sin freno esa lectura se habría llevado
621 órdenes de trabajo. En órdenes de servicio hay además un freno propio: si
alguna pestaña de área no se pudo leer, no se borra nada de ninguna, porque las
filas de esa área faltan en bloque.

**Al encenderlo no había nada que borrar, en ninguna.** Medido el 18/10/2026
con `npx tsx scripts/ensayo-borrado-mantenimiento.mts`, que lee las planillas
con las mismas funciones que usan las sincronizaciones:

| | En la planilla | En la base | A borrar |
|---|---:|---:|---:|
| Órdenes de trabajo | 2.200 | 2.200 | 0 |
| Avisos | 172 | 172 | 0 |
| Órdenes de servicio | 262 | 262 | 0 |
| Requerimientos de Compras | 2.159 | 2.159 | 0 |

Es el mejor resultado posible: el borrado no tenía un acumulado que arrastrar,
así que sólo va a actuar cuando alguien saque una línea a propósito. Conviene
volver a correr ese ensayo antes de cualquier cambio en cómo se lee una
planilla — un parseo que empeore se ve acá como filas "que la planilla ya no
tiene", y el freno lo va a frenar, pero mejor verlo antes.

**Y corre solo, cada quince minutos**, desde
`.github/workflows/mantenimiento-sync.yml`. El cron de `vercel.json` es la red
diaria por si Actions falla. O sea que el borrado es automático y desatendido,
dentro del freno; lo que hizo queda en `auditoria` con `accion = 'borrar'` y
los números en el `contexto`.

Quien mire el número y sepa que el borrado grande es correcto lo confirma
repitiendo la llamada con `?confirmar_borrado=1`. **El cron nunca lo manda.**

**Si no se puede auditar, no se borra.** El registro se escribe *antes* que el
`DELETE` y, si no entra, la corrida no borra nada. Es al revés que las otras
seis rutas que auditan —ahí la acción ya pasó cuando se registra—, y acá se
puede elegir el orden. La migración `20261018134754` es la que agrega el verbo
`borrar` al check de `auditoria`: **sin ella aplicada, esto no borra nada y lo
dice en la respuesta.**

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

**La prioridad también, desde el 16/10/2026 — y hasta ese día, no.** La planilla
escribe `🟡 Media` en sus 130 filas con prioridad y el filtro del listado usa esa
forma, pero `NuevaOTModal` tenía su propia copia del vocabulario —`["ALTA",
"MEDIA", "BAJA"]`— y el alta la escribía tal cual. **Una OT creada desde la app
no aparecía al filtrar por «Media»**, y no se notaba porque una orden que falta
en un filtro se lee como "no hay ninguna". La traducción vive en
`prioridadParaLaPlanilla` y se aplica **antes de guardar**, así la base queda con
una sola forma y el filtro puede seguir siendo un `.in()` liso. El modal ya no
tiene su copia: usa `PRIORIDADES_DE_OT`, para que lo que se elige sea lo que se
filtra. La única fila afectada —la 2796— se normalizó.

Antes de escribir se comprueba que la fila **siga siendo la de esta OT** —se lee
la columna A y se compara el número—. Si no coincide no se escribe nada y se
pide sincronizar: el número de fila se corre en cuanto alguien inserta una fila
arriba.

Escribir en la planilla es best-effort: si Google está caído, o la planilla no
está compartida como editor, el trabajo igual quedó registrado y la pantalla
dice qué falta completar a mano.

**Y "no se escribió" nunca se devuelve como `null`, desde el 16/10/2026.**
`escribirEnLaFilaDeLaOT` se iba en silencio cuando faltaba `GOOGLE_SHEETS_OT_ID`
o cuando la OT no tenía `sheets_row` — devolviendo el mismo valor que "salió
bien". La segunda es el estado normal de una OT recién creada desde la app: la
fila del master la pone la sincronización, así que **registrar el trabajo sobre
una OT nueva no escribía nada y no avisaba**. Le pasó a la 2796: se creó, se
registró —completada, 1 hora, dos operarios— y la planilla no se enteró de nada.
Horas después volvió a morder al repararla a mano, con un script que leyó ese
`null` como éxito y reportó cinco celdas escritas que nunca se escribieron. Un
diagnóstico que no se distingue de otro no es un diagnóstico; uno que no se
distingue del éxito es peor. Ahora lo dice `porQueNoLlegaALaPlanilla`, con sus
tests, y devuelve **las dos razones juntas** si faltan las dos.

Del otro lado, que es donde se cerraba el círculo: `changeEstado` y
`cambiarParada` del listado hacían `await fetch(...)` y **no miraban nada**, ni
`res.ok`. Un 403 se veía igual que un cambio que salió bien. Ahora las dos
pasan por `contar()`, que muestra el error o el `planilla_error` en el mismo
cartel donde ya se mira lo que salió a medias.

**La columna M del master tiene una fórmula, y escribirla la reemplaza a
propósito.** Cada fila nueva nace con `=IF(Jn="","",Ln)`, que copia el
"Atrasado / Por hacer" calculado de la L hasta que alguien pone el estado de
verdad. Las filas que dicen "Realizado" son literales que pisaron esa fórmula —
es como funciona la planilla, no un accidente. Conviene saberlo al mirar una OT
recién creada: su M dice "Atrasado" sin que nadie lo haya decidido.

**La foto quedó afuera.** El origen la sube a Drive con un Apps Script propio
(`/api/fotos-drive`) y escribe el link en la columna V. Ese endpoint no existe
acá y montarlo es un proyecto aparte. La columna V ya está mapeada, así que
cuando haya dónde subirla es sumar el campo.

## La falla que tuvo el equipo

Desde el 26/10/2026, al dar una OT por realizada se puede anotar **qué falla
tuvo la máquina**: dos desplegables cortos —*qué le pasó* y *por qué*— y un
detalle libre, los tres opcionales. La ficha del equipo muestra con eso **cuál
se repite más**, que es lo que se pidió.

La OT ya contaba qué se hizo; esto cuenta por qué falló, que no es lo mismo:
"cambio de eje" no dice si el eje se rompió por fricción, por un golpe o porque
nunca se lubricó, y esas tres cosas se arreglan distinto.

**No ordena algo que ya existía: lo empieza a juntar.** Medido sobre las 2.264
OT de ese día: el MTBF ya contaba 976 fallas —toda correctiva— pero sin causa;
sólo 99 descripciones nombran qué le pasó a la pieza y **ninguna** nombra el
motivo. Las 40 que lo parecían dicen "se repuso térmico" o "se cambia
contactor", que es otra vez el trabajo.

**Por qué dos listas y no un campo de texto.** Contar "cuál se repite" exige que
la misma falla se escriba igual dos veces, y el texto libre no lo logra: de 178
equipos, sólo 18 tenían dos veces la misma descripción exacta, y lo que sí se
repetía aparecía como `SE ROTAN MARTILLOS`, `ROTACION DE MARTILLOS` y `CAMBIO DE
MARTILLOS` — 23 órdenes del mismo evento en el mismo equipo, tres fallas
distintas para cualquier conteo. El vocabulario vive en
[lib/mantenimiento/fallas.ts](../lib/mantenimiento/fallas.ts) y **la ruta
rechaza con 400 lo que no esté en él**: sin eso vuelve el texto libre por la
ventana. No hay "Otro" a propósito; una falla con sólo detalle cuenta igual,
como «Sin clasificar».

Tres cosas que no se deducen del código:

- **Se carga en las tres puertas** por las que una OT queda realizada: el modal
  de registrar el trabajo, la OT nueva que nace cerrada —5 de las 6 creadas
  desde la app nacieron así— y el formulario sin señal. La única que queda
  afuera es la generación en lote de los partes de contratista, donde no hay
  nadie a quien preguntarle por cada orden.
- **No viaja a la planilla.** Riesgo asumido y no olvido, igual que el GUT:
  exportarla sería escribir en el libro que está por darse vuelta, y la regla
  de "toda ruta que toque un campo que se exporta tiene que exportar" no aplica
  a un campo que no se exporta. Quien lee la planilla no ve la falla. La
  sincronización tampoco la pisa: su `upsert` nunca nombra esas columnas.
- **Una OT ya cerrada no puede cargar su falla sin reabrirla**, así que las 976
  correctivas que ya existen se quedan sin causa. Esto empieza de cero.

## Crear una OT desde el sistema: la planilla primero, y en su propia pestaña

**Una OT creada desde la app se escribe en el libro de respuestas del
formulario, no en la pestaña `OT` del master.** Esa pestaña es el derrame de
cuatro `QUERY(IMPORTRANGE(...))` y no tiene un solo literal en la columna A:
escribir ahí o bloquea el derrame —`#REF!`, y se borra la importación entera— o
lo pisa el derrame al recalcular.

**Y dentro de ese libro va a `Altas del sistema`, no a `Respuestas de
formulario`.** Es lo que cambió el 16/10/2026 y lo que más caro salió:

> Se creó la OT **2796** desde el sistema y se le escribió la fila en la pestaña
> del formulario. Entraron dos respuestas. **Forms inserta dentro de su propio
> rango y empuja hacia abajo cualquier fila ajena**, así que 2796 y 2797 bajaron
> dos lugares; las columnas `A`–`J` y `S` del master son derrame y se movieron
> con ellas, las `K`–`R` son literales y se quedaron. Resultado medido: la **OT
> 2798 figuraba como «Realizado, 1 h, Aguirre, Mendizabal»** — el registro de la
> 2796, pegado a la orden de otro.

La premisa del diseño anterior era *«acá sí conviven, porque el master ordena
por N° de OT»*. Se leyeron las cuatro importaciones: **ninguna tenía `ORDER
BY`**. Dependía de una propiedad que la planilla no tenía y nada lo comprobaba.

**Son dos mitades y ninguna alcanza sola.** La pestaña aparte saca las filas del
sistema del rango donde Forms inserta; el `ORDER BY` es lo que hace que agregar
una fila no corra las de arriba —apilar `{formulario; sistema}` sin ordenar deja
el bloque del sistema abajo y cada respuesta nueva lo corre entero—. Como toda
OT nueva es el máximo de la serie, ordenar por N° deja la salida estrictamente
creciente. Es lo mismo que Compras resolvió el 11/09/2026.

**La serie vive en dos hojas**, y eso obliga a que las cuenten las dos: el SdG
en `loQueSigueEnLaSerie` y el Apps Script en `maximoDeLaHoja_`. Contar una sola
es repartir un número que la otra ya usó.

**El orden es planilla y después base.** La planilla manda: una orden existe
cuando tiene su fila. El número sale de la misma lectura que la fila, así que si
la escritura no se puede hacer no se creó nada en ningún lado y no se consumió
ningún número. El precio, dicho: con Google caído no se puede crear una OT desde
la app. Es visible y se reintenta; lo otro no se veía nunca. Si la fila se
escribe y después falla el insert, la OT queda sólo en la planilla —el estado
normal de cualquier orden del formulario— y la sincronización la trae.

**Tres guardas en el alta**, cada una por un modo de falla concreto: el
encabezado se lee de `Altas del sistema` y no del formulario (esa pestaña la
crea una persona, así que existir sin encabezado es un estado real); se relee la
celda destino justo antes de escribir (dos altas a la vez calculan la misma fila
libre y la segunda pisaría a la primera); y se relee lo escrito (es lo único que
distingue "quedó con su número" de "quedó con el de otro").

**La fila dice quién la pidió**, desde el 18/10/2026: el correo, el nombre y el
apellido salen del usuario de la sesión y van a las columnas `C`, `D` y `E`.
Antes quedaban vacías a propósito —*"poner algo en el mail o el nombre sería
decir que alguien contestó el formulario"*—, y esa razón se murió al mudar el
alta a su propia pestaña: una fila en `Altas del sistema` no dice que nadie
contestó nada, dice que la creó el sistema. Es lo que le faltaba a quien mira la
planilla para saber a quién preguntarle. La **Puntuación** sigue sin tocarse:
ésa sí es del formulario.

**La precondición sigue siendo que la columna A del formulario esté congelada.**
Mientras tenga una fórmula viva, crear una OT devuelve 502 explicando por qué,
sin tomar número.

### Una OT puede nacer realizada, y eso tiene que llegar a la planilla

No es un caso raro: de las seis órdenes creadas en el sistema hasta el
18/10/2026, **cinco** nacieron con fecha de cierre, horas y operarios. No se
está pidiendo trabajo, se está cargando trabajo ya hecho.

**La fecha de cierre manda sobre el estado.** Si hay cierre, la orden nace
`REALIZADO` — elegirlo aparte es contestar dos veces la misma pregunta, y es
donde quedan las OT cerradas figurando "por hacer". Y si ya se hizo, el
formulario **exige** las horas y quién la hizo: un operario si es interno, el
contratista si es contratado, los dos si es mixto. Una OT cerrada sin eso no
sirve para el MTBF ni para las horas por sector, y nadie se entera hasta que el
informe sale con la mitad de las filas vacías.

**Esos datos viven en las columnas literales del master** —`K` cierre, `M`
estado, `N` contratista, `O` horas, `P`/`Q`/`R` operarios— y **el alta no las
puede escribir en el momento**: la fila del master llega por `IMPORTRANGE` y
tarda. Se intenta igual, y si no se puede queda anotado en `sheets_pendiente`,
con la pantalla diciéndolo.

Lo que costaba no tenerlo, medido el 18/10/2026: el cron de las 06:00 lee la
`M`, la encuentra vacía y pisa el estado; con las horas es peor, porque las lee
de la `O` y las pisa con `null`. **Las cinco OT que hoy siguen en REALIZADO lo
están porque alguien les escribió "Realizado" a mano en la planilla.**

**La sincronización exporta antes de importar**, y ése es el orden que importa:
al revés, el master vacío borraría el estado justo antes de que lo
escribiéramos. Y **lo que sigue pendiente no se pisa** — la planilla todavía no
sabe lo que el sistema sabe. Es el mismo principio que `editado_en_app` en
Compras y que *"no pisa lo que una persona corrigió"* en las marcaciones.

**`POR_HACER` es el único estado que no se exporta**, y no por ahorrar una
escritura: la `M` trae `=IF(J="","",L)`, la fórmula con la que la planilla marca
sola lo atrasado. Escribirle "Por hacer" la reemplaza por un literal y la orden
queda fija en "por hacer" el día que se pase de fecha.

### La fila del master se busca, no se calcula

Con el `ORDER BY`, la posición de una fila dejó de ser estable. Compras lo dice
con todas las letras: *«una cuenta que deja de valer no avisa: sigue devolviendo
un número plausible»*. `escribirEnLaFilaDeLaOT` busca la OT por su número en la
columna A —`filaDeLaOTenElMaster`— y si no está, no escribe. No encontrarla es
lo **normal** recién creada, porque el `IMPORTRANGE` tarda; por eso el mensaje
pide reintentar en vez de sonar a error.

`sheets_row` sigue en la base y la sigue llenando la sincronización, pero la
escritura dejó de apoyarse en ella.

### Lo que queda a mano en las planillas

Nada de esto lo puede hacer un agente. Hasta que estén los cuatro, crear una OT
desde el sistema falla con el motivo en pantalla.

1. **Crear `Altas del sistema`** en el libro de respuestas, con el **mismo
   encabezado de 31 columnas** que `Respuestas de formulario` en la fila 1.
2. **Reemplazar las cuatro importaciones del master.** Ojo con dos cosas: la de
   la columna `D` pasa de `D3` a **`D2`**, y la de `S2` cambia de rango porque
   necesita la columna A para poder ordenar.

```
A2  =QUERY({IMPORTRANGE(FORM, "Respuestas de formulario!A2:F10000");
            IMPORTRANGE(FORM, "Altas del sistema!A2:F10000")},
           "SELECT Col1, Col2, Col6 WHERE Col1 IS NOT NULL ORDER BY Col1", 0)

D2  =LET(d, {IMPORTRANGE(FORM, "Respuestas de formulario!A2:U10000");
             IMPORTRANGE(FORM, "Altas del sistema!A2:U10000")},
         k, CHOOSECOLS(d, 1),
         e, BYROW(CHOOSECOLS(d, SEQUENCE(1,15,7)), LAMBDA(f, TEXTJOIN("", TRUE, f))),
         SORT(FILTER(e, k<>""), FILTER(k, k<>""), TRUE))

E2  =QUERY({IMPORTRANGE(FORM, "Respuestas de formulario!A2:AA10000");
            IMPORTRANGE(FORM, "Altas del sistema!A2:AA10000")},
           "SELECT Col22, Col23, Col24, Col25, Col26, Col27
            WHERE Col1 IS NOT NULL ORDER BY Col1", 0)

S2  =QUERY({IMPORTRANGE(FORM, "Respuestas de formulario!A2:AC10000");
            IMPORTRANGE(FORM, "Altas del sistema!A2:AC10000")},
           "SELECT Col29 WHERE Col1 IS NOT NULL ORDER BY Col1", 0)
```

   Probadas el 16/10/2026 en tres pestañas temporales con una fila cuyo equipo
   estaba en la columna `S` —la que rompe un `CHOOSECOLS` mal contado—; el
   detalle está en el [spec](superpowers/specs/2026-10-16-mantenimiento-altas-del-sistema-design.md).

   **Que la `D3` de hoy funcione es una casualidad**: la primera fila de
   respuestas es la OT 622 y no tiene nada entre `G` y `U`, así que el `FILTER`
   la descarta y lo que queda arranca justo donde va. Si esa fila hubiera tenido
   equipo, las 2.174 filas de EQUIPO estarían corridas una sin que nada avisara.

3. **Pegar el Apps Script actualizado** —`docs/mantenimiento-formulario-apps-script.gs`—,
   que ahora cuenta las dos pestañas en sus dos funciones.
4. **Congelar `Respuestas de formulario!A2:A`**: copiar y pegar como sólo
   valores.

## Por qué una OT todavía no se hizo

La observación de arriba se completa **al realizar** el trabajo: qué se
encontró, qué se cambió. Para una OT que sigue abierta no servía, porque no hay
ejecución de la que colgarla — y ésa es justamente la que hay que explicar. Al
16/10/2026 había **40 órdenes abiertas**: 24 atrasadas, 12 por hacer, 4 en
proceso, ninguna con dónde decir por qué.

**Es un historial y no un campo.** Una OT atrasada se vuelve a justificar con el
tiempo —"falta el repuesto" y dos meses después "esperamos la parada de
planta"—, y pisar la razón anterior borra la única señal de que se viene
postergando, que es lo que una revisión quiere ver. Las notas viven en
`ordenes_trabajo_notas` (migración `20261016092258`), con quién y cuándo, y
**no se editan**: un historial que se puede reescribir no es un historial. Un
error se arregla borrando la propia nota y escribiendo otra.

**A la planilla va la última**, a la columna X, porque una celda no es una
lista y lo que le sirve a quien la mira es por qué está parada *hoy*. Se escribe
por el mismo camino que la W —`escribirEnLaFilaDeLaOT` de
`lib/mantenimiento/planillaDeOT.ts`, con su guarda de que la fila siga siendo la
de esta OT— y borrar una nota reescribe la celda con la que quedó siendo la
última: dejar la anterior sería mentir sobre por qué está parada.

**El texto va escapado.** Las escrituras usan `USER_ENTERED`, así que un "12/10"
se vuelve una fecha y un "=A1" una fórmula que lee otra celda. `textoParaLaCelda`
de `lib/core/sheets.ts` antepone el apóstrofo —que Google consume— sólo a lo que
arranca con `= + - @` o es nada más que dígitos y separadores. **La prosa no se
fuerza**: "Se rompió el 12 de octubre" tiene letras y va tal cual.

**El cartel "Sin justificar" se pide aparte del listado.** Un
`ordenes_trabajo_notas(count)` colgado del `select` de las órdenes funciona
—está probado contra la base— pero ata la pantalla entera a que la tabla exista:
un deploy antes de correr la migración dejaría las órdenes en 400. Con el pedido
aparte, lo único que pasa es que los carteles no aparecen. Se marca la que **no**
tiene: la que sí tiene se abre y se lee.

**Qué falta a mano en la planilla:** la pestaña `OT` tenía exactamente 23
columnas, así que hay que ensancharla a 24 y poner `OBSERVACIÓN PREVIA` en `X1`.
Hasta que esté, la nota se guarda igual y la pantalla avisa que no llegó a la
planilla con lo que haya dicho Google.

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
  sector, quince columnas fijas A..O iguales en todas, así que se lee por
  posición. Varias filas con el mismo N° de OS son las ofertas que se
  compararon; `ELECCIÓN` marca cuál se tomó. Son **catorce** desde el
  16/10/2026 — ver abajo.

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

### Una pestaña nueva en la planilla no rompe nada, y por eso muerde

La lista de pestañas está escrita en el código (`COMPARATIVA_PESTANAS`), porque
es la que decide **a cuál va** una cotización cargada desde la app:
`pestanaDeSector` manda a `Otros` todo lo que no reconoce, que es lo correcto
para un sector sin pestaña propia —`Equipos móviles`, `Laboratorio`— y lo
incorrecto para una pestaña que existe y el código no conoce.

`Cantera` y `Despacho` se agregaron a la planilla después de escribir el módulo.
Hasta el **16/10/2026** el sistema no las tenía, y nada lo dijo en ningún lado:

- La sincronización **no leía esas dos pestañas**. Sus cuatro cotizaciones —las
  tres de la OS 240 en `Cantera` y la de la OS 250 en `Despacho`— no existían en
  el espejo: la app mostraba esas OS sin ninguna oferta.
- Una cotización cargada desde la app para un sector de ésos **se escribía en
  `Otros`**. Sale bien: la fila entra, el número de fila vuelve, el espejo
  queda consistente. Lo único que pasa es que quien va a buscarla a la pestaña
  de su sector no la encuentra. Así apareció: se cargó la cotización de la OS
  250 (sector Despacho) y fue a `Otros!7` mientras la pestaña `Despacho` seguía
  con la fila cargada a mano.

Por eso **la sincronización ahora compara** la lista del código contra las
pestañas que la planilla tiene de verdad (`pestanasQueFaltan`) y nombra las que
sobran en el resultado y en el registro. Es un aviso, no un error: las pestañas
conocidas se leen igual, y si la planilla no se puede listar la corrida sigue.

Sumar una pestaña es agregarla a `COMPARATIVA_PESTANAS` **en el orden de la
planilla**, y nada más: el resto del módulo la toma de ahí.

### La trampa de los decimales

`monto()` tenía que distinguir tres formas del mismo número: el que manda Sheets
sin formato (`1848315.535`), el que escribe una persona (`" $1.972.500,00"`) y
el que sale de `String(n)` al guardarlo. Tomar todos los puntos por separadores
de miles daba **mil veces el precio**: hacía aparecer diferencias de miles de
millones donde la elegida era, de hecho, la más barata. La regla es: con coma,
formato argentino; sin coma, un punto solo es decimal y varios son de miles.

### Cargar una cotización desde la app

La comparativa se puede trabajar sin abrir el Sheets: se carga el presupuesto
que llegó por mail y se escribe **primero en la planilla** y después en el
espejo. Al revés quedaría una cotización que la próxima sincronización borra sin
dejar rastro, porque el refresco es completo.

El proveedor se elige de la lista de contratistas en vez de escribirse —en las
planillas hay cinco maneras de escribir "Don Alfredo" justamente porque cada uno
lo tipeaba de nuevo—, con la opción de sumar uno que no esté.

A la planilla van **números**, no lo que se tipeó: sus fórmulas los usan. Y el
IVA va como fracción, que es como lo guarda —muestra "21%" y vale 0.21—.

Sacar una cotización **vacía** su fila en vez de borrarla, por lo mismo de
siempre: borrarla correría todas las de abajo.

#### El PRECIO TOTAL no es un número: es una fórmula

La columna `J` de las catorce pestañas tiene `=H+(H*I)` —precio unitario más
IVA— en las 199 filas de cada una. **Escribirla la mata**, y eso es lo que hacía
el alta hasta el **16/10/2026**: armaba las quince celdas y mandaba el total
como número literal.

Medido contra la planilla ese día: las filas cargadas a mano tenían
`=H6+(H6*I6)` y la única escrita por el SdG —la cotización de la OS 250— tenía
`2395800` pelado. Se veía a simple vista, porque al perder la fórmula perdió
también el formato de moneda: las demás decían " $2.395.800,00" y ésa,
"2395800".

Importa porque **acá manda la planilla**: si después alguien corrige el precio
unitario, todas las filas recalculan su total menos la que cargó el sistema, y
nada avisa.

El arreglo usa lo que `agregarFila` ya sabía hacer: un `null` en el arreglo es
"esta celda no se toca" y la escritura se parte en tramos salteándola. Quién
decide es `elTotalLoCalculaLaPlanilla()`, y la regla tiene tres casos:

- **El total es el que daría la fórmula** → la `J` va en `null` y la fórmula
  sobrevive. La comparación tolera **un centavo**: el formulario redondea
  (`Math.round(u * (1 + iva) * 100) / 100`) y la planilla no, así que pedir
  igualdad exacta entre floats diría "no coincide" en cotizaciones que
  coinciden.
- **El total está pisado a mano** → va el número, que es lo correcto y
  deliberado: el formulario deja pisarlo porque a veces el proveedor cotiza un
  total que no sale de esa cuenta. Ahí la fórmula estorba.
- **No hay precio unitario** → va el número igual: la fórmula daría cero y el
  total cotizado es lo único que hay.

Las otras celdas vacías —`K` vigencia, `L` plazos, `M` condiciones, `N` otras
especificaciones— siguen yendo en `""` y no en `null`. Se miró: ahí no hay
fórmula que cuidar, y dejarlas sin tocar heredaría lo que tuviera esa fila de
antes.

El borrado tiene el mismo problema por el otro lado —vaciaba las quince
columnas, fórmula incluida— y se resolvió con la misma función: la `J` se vacía
**sólo** cuando el alta había escrito ahí un número, que es el único caso en que
ya no hay fórmula que salvar; dejarlo sería un número suelto en una fila por lo
demás vacía. Cuando la fórmula está viva no se la toca, y la fila queda
mostrando " $0,00" como todas las vacías de la pestaña.

Un detalle que conviene saber antes de tocar esto: la fórmula de `J` **no es la
misma en toda la planilla**. De cierta fila en adelante —la 26 en
`Planta de Trituracion 3`, la 98 en `Planta Filler 2`— el relleno cambia a
`=G*H*(1-#REF!)*(1+I)`, resto de una versión vieja del libro que tenía columna
de descuento. Hoy no molesta porque las filas cargadas son pocas y las nuevas
caen muy por encima de ese límite, pero es la razón por la que el borrado **no
restaura** la fórmula: no hay una sola que restaurar.

### Una columna que faltaba

`os_comparativas` guardaba el equipo sólo como texto libre, mientras
`ordenes_servicio` y `avisos` guardan además el código y el enlace. Faltaba de
verdad: la sincronización leía `equipo_code`, lo mandaba en el insert, y el lote
entero fallaba con "Could not find the 'equipo_code' column". Por eso no entró
ninguna de las 147 cotizaciones. La **migración 035** suma esa columna y
`equipment_id`, y ahora se puede ver lo que se cotizó de una máquina sin pasar
por la OS.

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

### Aprobar una OS: lo hace Compras, y por qué se puede

Desde el 4/09/2026 la aprobación de una OS vive en **Compras → Aprobaciones**,
en una segunda sección debajo de los requerimientos. Es el mismo momento del
circuito en los dos casos: lo que espera un sí antes de que se le pidan
presupuestos. El diseño está en
[el spec](superpowers/specs/2026-09-04-aprobar-os-desde-compras-design.md).

**Hasta entonces aprobar desde la app era imposible a propósito.** `APROBADO` es
el único valor que el `FILTER` de una pestaña levanta, y levantar una fila corre
las de abajo mientras el seguimiento escrito a mano no se corre con ellas. Por
eso `seguroParaElMaestro()` lo bloqueaba en seco y sólo se podía denegar —una OS
denegada ya estaba afuera de la pestaña y sigue afuera, así que no mueve nada—.

**Lo que lo destrabó fue medir la trampa.** Comparando `sheets_row` contra
`os_number` dentro de cada pestaña, sobre las 228 filas de la base:

| Pestaña | Filas | Fuera de orden | Última |
|---|---|---|---|
| MANTENIMIENTO | 167 | **0** | 218 @168 |
| TALLER VIAL | 31 | **0** | 208 @32 |
| PRODUCCIÓN | 11 | **0** | 177 @12 |
| ALMACÉN | 4 | **0** | 171 @5 |
| LABORATORIO | 2 | **0** | 174 @3 |
| CANTERA | 1 | **0** | 190 @2 |
| OTRA | 1 | **0** | 91 @2 |

Cero desórdenes en las siete: **el `FILTER` conserva el orden ascendente por
número**. Entonces la fila entra en el medio sólo si su número es menor que el
de alguna que ya está ahí, y de ahí la regla que gobierna
`lib/mantenimiento/aprobacion.ts`:

> Aprobar no corre ninguna fila si el número de la OS supera al máximo que ya
> está en la pestaña de su área.

De las once que esperan decisión, diez la cumplen; la **26** no —entraría cerca
de la fila 21 y correría 147 filas de seguimiento— y el sistema se niega
diciendo qué pasaría y que hay que aprobarla a mano. Las que entren de acá en
adelante siempre la van a cumplir, porque llegan con el número más alto.

**Estar en `SERVICIOS` es no estar aprobada**, y por eso la bandeja se arma
filtrando por la pestaña y no por el estado. Eso separa dos grupos que en el
listado se ven iguales, los dos con el estado vacío: **11 esperan decisión** y
**23 ya fueron aprobadas** y lo que les falta es el seguimiento. Pedirle a quien
aprueba que decida sobre las 23 sería hacerle perder el tiempo.

**Aprobar va al revés del resto de las escrituras.** Primero la planilla y
después la base, y si la planilla no acepta no se guarda nada. Una OS aprobada
sólo en el sistema no llega nunca a la pestaña de su área: nadie del área la ve,
la comparativa no aparece, y el sistema dice que sí mientras la planilla la
sigue mostrando por aprobar. Es la única excepción al best-effort.

**Quién aprueba: `os_aprobadores`**, lista propia y separada de
`compras_aprobadores`, porque aprobar un servicio y aprobar un material los
decide gente distinta. Hoy tiene sólo a Nico. Se administra en Configuración de
Compras.

Y la lista gatea **la decisión, no la palabra**: una OS que ya está en la
pestaña de su área puede recibir `APROBADO` de cualquier editor de
Mantenimiento, porque ahí el estado es seguimiento como cualquier otro campo.

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

El libro tiene nueve hojas y el importador usa cuatro: `SECTORES` (15),
`EQUIPOS` (239), `TIPO_EQUIPO` (26) y `COMPONENTES` (398). Se puede volver a
importar cuantas veces haga falta: sectores y equipos se reconocen por su
código.

Al portarlo, el libro traía el **padrón** —qué máquinas hay, cómo se llaman,
dónde están y para qué sirven— pero casi nada del **relevamiento**: de 239
equipos, 15 tienen marca, 20 modelo, ninguno rodamientos ni año, y la criticidad
está vacía en todos. Por eso el importador crea los equipos con lo que hay y
completa el resto a medida que el libro avanza.

**Un equipo sin estado se da por operativo.** Son 215 de 239, y darlos por fuera
de servicio apagaría media planta en el tablero. Los 24 que traen estado lo
abrevian: `op`, `rep`, `fuera`.

**Un equipo sin sector no se crea.** La columna es obligatoria y colgarlo de
cualquier sector lo pondría en una planta donde no está: se informa y queda
afuera.

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
- **Las órdenes del mes y cómo viene el año**, en un solo panel: el número
  grande al lado de la serie de los últimos doce meses. El número solo no dice
  nada —139 puede ser mucho o poco— y la serie sola obliga a buscar el último
  mes con la vista. La barra del mes en curso va en otro color: es la única que
  todavía puede crecer, y verla igual que las cerradas hace creer que la
  actividad cayó.
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
cae el último del anterior y las órdenes se cuentan en el mes equivocado. Y el
nombre del mes sale de una lista y no de `toLocaleDateString`: un servidor sin
locale español diría "OTs generadas en August".

## Despacho filler deja de ser un sector

El libro BD Equipos parte cada filler en dos: `PY-A1 Filler 1` y
`PY-A2 Despacho filler 1`, `PY-B1 Filler 2` y `PY-B2 Despacho filler 2`. En la
planta es un solo lugar, y el resto del sistema ya lo trataba así: las 107
órdenes de trabajo de los dos despachos dicen `sector_raw = "Planta filler 1"`
y `"Planta filler 2"`, **ninguna dice "Despacho"**. Cayeron en el sector de
despacho porque el sector se deduce del equipo y la máquina es una `PY-A2-xx`.

La **migración 044** los une: 33 equipos, 107 órdenes de trabajo, 2 avisos y 2
órdenes de servicio pasan a su filler, y los dos sectores se borran. Quedan 13
sectores de planta; Filler 1 tiene 45 equipos y Filler 2, 31.

Se borran y no se desactivan porque `sectoresDePlanta()` filtra por
`es_de_planta` y no por `activo`: un sector inactivo seguiría en todos los
desplegables.

**Los códigos de los equipos no se tocan.** Siguen siendo `PY-A2-01` y compañía:
es lo que los identifica contra el libro, y renombrarlos rompería la próxima
importación sin arreglar nada.

**El libro sigue diciendo PY-A2 y PY-B2**, y su importación reconoce los
sectores por código y los vuelve a crear. Mientras el libro no se corrija, un
"Importar BD Equipos" deshace la fusión. Es el mismo patrón que las ubicaciones
de Compras: si se corrige de un solo lado, la planilla lo recrea.

## Los sectores de planta, aparte de los organizativos

`sectores` guardaba dos cosas distintas con el mismo nombre: dónde trabaja una
persona —"Administración", "Producción (RRHH)"— y dónde está una máquina
—"Calcinación", "Filler 2", "Compresores"—. Son taxonomías distintas y las usa
gente distinta.

La **migración 033** las distingue con `es_de_planta`, y suma `codigo` —PO-A1,
PY-B1, AMB-C1— que es lo que permite reimportar el libro sin adivinar por
nombre. No se partió la tabla en dos porque avisos, OT y OS ya apuntan a
`sectores.id`, y partirla obligaría a rehacer esos enlaces sin ganar nada.

`AMBOS` no es una empresa: es donde van los equipos que sirven a las dos
—compresores y equipos móviles—. En el SdG eso ya tenía nombre, `transversal`, y
la base exige una cosa o la otra: o el sector tiene empresa, o está marcado
transversal.

### El nombre del sector es la clave de enlace, y por eso no se toca a gusto

**Renombrar un sector de planta rompe el enlace de la planilla, en silencio.**
La columna SECTOR de la planilla de OT la llena un formulario de Google con una
lista fija, y `cargarEnlaces()` busca el sector **por nombre** —en minúsculas—
cuando la fila no trae un equipo que lo diga. El código es el otro camino, pero
el formulario escribe el nombre, no el código.

El 19/10/2026 eso tenía **184 órdenes sin sector** y nadie lo había visto,
porque una OT sin sector se ve igual que una OT: el filtro simplemente no la
trae. Las causas, medidas:

| OT | decía la planilla | por qué no enlazaba |
|---:|---|---|
| 99 | Servicios auxiliares | el sector no existía en el SdG |
| 29 | Taller | no existía |
| 29 | Planta filler 1 | el catálogo lo llamaba "Filler 1" |
| 26 | Planta filler 2 | lo llamaba "Filler 2" |
| 1 | (vacío) | no hay con qué |

Se acomodó el catálogo a lo que la planilla ya escribía —ocho renombres y dos
altas, en `scripts/sectores-de-la-ot.mts`— y 183 de las 184 volvieron a
enlazar solas en la sincronización siguiente. **La dirección importa:** se
cambió el SdG para que coincida con la planilla, no al revés, porque la
planilla manda y porque su lista la eligió quien usa el formulario.

Lo que hay que saber antes de renombrar uno: mirar primero qué dice la columna
SECTOR de la planilla. Si el nombre nuevo no es el que el formulario escribe,
ese sector deja de enlazar para toda orden que no traiga un equipo
identificado — hoy son 368 de 2.206.

**"Despacho cal" se dejó en el catálogo el 19/10 y se unió a Molienda de cal el
21/10.** Vale contar el error, porque el razonamiento parecía bueno: tenía 7
equipos y 39 órdenes, y se lo dejó pensando que la lista del formulario dice
*quién solicita* y el catálogo *dónde está la máquina*. Eso es cierto en
general y era falso acá — la división no existe en la planta, existe en el
libro BD Equipos, que parte la molienda en `PO-D1` y `PO-D2`.

Lo que lo delataba estaba a la vista y no se miró: **las 39 órdenes de PO-D2
dicen `"Molienda de cal"` y ninguna dice "Despacho"**, exactamente el patrón
que la migración `044` ya había documentado para los dos despachos de filler.
La prueba de que molestaba: eran la discrepancia más grande entre lo que
alguien escribía y dónde el sistema ponía la orden.

Lo une la migración `20261021085411`, con la misma advertencia que la `044`:
el libro sigue diciendo PO-D2 y su importación recrea los sectores por código,
así que **un "Importar BD Equipos" lo trae de vuelta** mientras el libro no se
corrija. Por eso `PO-D2` sigue en la lista de orden de
[lib/mantenimiento/sectores.ts](../lib/mantenimiento/sectores.ts): si vuelve,
que al menos aparezca al lado de la molienda y no al final.

**Los dos nuevos no llevan `codigo`.** Sale del libro BD Equipos y ahí no
tienen equipos; inventarles uno sería escribir un dato que dice venir de un
lugar del que no viene. Quedan en null como "Cantera".

**Y el desplegable no ordena por código.** Se intentó y no alcanza, por dos
razones que sólo se ven con la lista delante: los tres filler y la planta de
0-2 mm son PY-A1, PY-B1, PY-D1 y PY-C1 —el filler 3 va antes que la de 0-2 mm
aunque su código sea mayor—, y los tres sin código caían todos al final, con
Cantera última cuando es la primera del proceso. El orden es una lista
explícita en `enOrdenDePlanta()` de
[lib/mantenimiento/sectores.ts](../lib/mantenimiento/sectores.ts), la misma que
usa el formulario, y lo aplican las seis pantallas que piden sectores de
planta.

Esa lista va por **código** y no por nombre, que es lo que la hace sobrevivir:
los ocho nombres se cambiaron enteros el mismo día, y un orden colgado de
ellos se habría desarmado solo. Los tres sin código van por nombre, y eso es
lo frágil que queda — renombrarlos los manda al final sin avisar. Está fijado
con un test para que se note ahí y no en el desplegable. Un sector nuevo
también va al final: aparecer último se ve, colarse en el medio no.

**Distinguirlos no alcanza si después las pantallas no filtran.** El tablero
mostraba "Tesorería" al lado de "Trituración 1" porque seis pantallas traían
todos los sectores. El filtro vive ahora en `lib/mantenimiento/sectores.ts` y no
repetido en cada una: se pone en cinco lugares, falta en el sexto, y vuelve la
mezcla.

También filtra el **enlace por nombre** de la sincronización. Sin eso, un aviso
que dice "Mantenimiento" caía en el sector de RRHH que se llama igual — y era
exactamente lo que estaba pasando con las 27 órdenes que tenían sector.

## Reconocer un equipo en un texto libre

Las planillas nombran al equipo escribiendo, y el código está metido adentro:
"PO-B1-27 – Cadena de arrastre 6". El patrón alcanzaba hasta que aparecieron los
**21 equipos compartidos**, que se llaman `C1` o `EM2` — y la planilla de OS dice
"EM2 - Caterpillar 320 C".

Ningún patrón razonable distingue "EM2" de cualquier otra sigla suelta, así que
se busca **contra los códigos que existen de verdad**. Gana el más largo: "EM1"
está dentro de "EM16", y tomar el corto mandaría el trabajo a otra máquina.

Y cuando no hay equipo, se busca el **código del sector**: casi 300 órdenes dicen
cosas como "PO-C1 - Edificio" o "Vestuario" —trabajos que no son sobre ninguna
máquina, pero que igual pasaron en algún lado—.

Medido contra las 1.728 OT y los 138 avisos ya cargados: enlazan a un equipo el
**83%** y el **90%**; y quedan con sector conocido el **93%** y el **97%**. De los
códigos que las planillas nombran, el libro los tiene **todos**.

## El edificio de cada sector es un equipo del catálogo

Desde el 21/10/2026 cada sector de planta tiene en `equipos` una fila llamada
**"Edificio"**, y existe por una razón concreta: **«toda OT lleva equipo» rige
desde el 19/10/2026** y un trabajo sobre el edificio —un techo, una pared, un
piso, un portón— no es sobre ninguna máquina, así que desde el sistema **no se
podía cargar**. En la planilla sí se venía cargando: medido ese día, **314 OT,
12 avisos y 26 requerimientos** dicen «Edificio» en la columna EQUIPO y no
tienen equipo enlazado, porque `"PO-A3 - Edificio"` es una opción de la lista
del formulario de Google y no un equipo.

**El código es el que la planilla ya usa para ese edificio**, que casi siempre
es el del sector: el edificio de Calcinación es `PO-B1`. Con eso, lo que el
sistema escribe en la planilla —`"<code> – <name>"`— queda `"PO-B1 – Edificio"`,
que es palabra por palabra lo que la planilla ya dice, y la planilla no termina
con dos formas de nombrar lo mismo. De yapa, las **239 OT, 12 avisos y 19
requerimientos** que ya decían eso pasan a colgar del edificio de su sector en la
siguiente sincronización, sin tocar una fila a mano.

Tres cosas que no se deducen del código:

- **Dos edificios no llevan el código de su sector**: el del **filler 1 es
  `PY-A2`** y el del **filler 2 es `PY-B2`**; `PY-A1` y `PY-B1` son las plantas.
  La primera corrida los creó con el código del sector —deducir el código en vez
  de leerlo— y eso dejaba sin enlazar **56 OT**, más que las de cualquier otro
  sector. Por eso el script busca el edificio **por su sector** y no por su
  código: así le corrige el código sin crear un segundo edificio para el mismo
  lugar. El del filler 3 quedó en `PY-D1` porque ninguna fila lo nombra todavía;
  si la planilla dice `PY-D2`, es una línea en `CODIGO_PROPIO`.

- **La palabra «Edificio» no puede ser el código.** `buscarCodigo` se queda con
  el código más largo que encuentre, así que un equipo con código `EDIFICIO`
  ganaría contra `PO-A1` dentro de `"PO-A1 - Edificio"` y las filas de los otros
  doce sectores irían todas al mismo edificio. Por eso los tres sectores que no
  tienen código de planta —Cantera, Servicios auxiliares y Taller— llevan uno
  propio y delimitado: `CANTERA-ED`, `SERV-AUX-ED`, `TALLER-ED`. En la planilla
  esos tres escriben «Edificios» o «Edificio» pelado, sin código, así que una OT
  cargada allá para ellos sigue quedando sin equipo; una cargada desde el
  sistema trae el código y vuelve a enlazar sola.
- **No se lleva puesta ninguna máquina.** El borde de `buscarCodigo` son los
  caracteres que no son letra, número ni guión, así que `PO-A1` **no** matchea
  dentro de `"PO-A1-24 - Cinta transportadora 16"`. Medido sobre las 2.224 OT,
  los 183 avisos, los 2.167 requerimientos y las 264 OS: las 270 filas que
  cambian de enlace dicen todas «Edificio».

Lo escribe `npx tsx scripts/edificio-de-cada-sector.mts --aplicar`,
que sin `--aplicar` sólo dice qué haría y vuelve a medir qué filas se moverían.

Quedan sin equipo **70 OT que dicen «Edificios» o «Edificio» pelado**, de los
tres sectores sin código, y cinco textos de una sola vez como «C - Edificio».

## El menú, igual que en la app de Mantenimiento

El mismo orden y los mismos nombres, y **sólo** ésos: Dashboard, Equipos,
Avisos, Órdenes de trabajo, Órdenes de servicio, Planificación, Producción,
Historial, Usuarios y Configuración.

**Mantenimientos** y **Ejecuciones** salieron. Eran pantallas propias del ERP
que la app de Mantenimiento no tiene —allá el preventivo vive dentro de
Planificación— y sumaban dos entradas a un menú que ya tenía diez. Las páginas
quedan en el repo pero sin acceso desde el menú.

Sacar Ejecuciones no dejó nada huérfano porque **Historial muestra lo mismo**.
Pero traía sólo las ejecuciones colgadas de un mantenimiento programado, así que
dejaba afuera todo lo que se registra al cerrar una OT —que es por donde entra
la mayor parte del trabajo de la planta—. Ahora muestra las dos, y el equipo lo
busca por el enlace directo, por el mantenimiento programado o, si no hay
ninguno, por la orden.

**Usuarios** apunta a `/administracion/usuarios`, que es donde el SdG los
administra para todos los módulos —igual que hace RRHH— en vez de tener una
pantalla propia.

## Configuración de Mantenimiento

Las listas de las que come el módulo, para que registrar una orden de trabajo
sea elegir y no escribir. Escribir cada vez es cómo terminan "Candia" y "CANDIA"
siendo dos personas distintas.

- **Operarios**, con sus tres posiciones: la orden tiene tres columnas de
  operario y cada una tiene su propia lista.
- **Contratistas**: los proveedores marcados como tales. Sacar uno de acá no lo
  borra —la ficha es de todo el SdG y Compras le sigue comprando—: sólo le quita
  la marca.
- **Tipos de equipo** y **sectores de planta**: de sólo lectura, porque vienen
  del libro BD Equipos y se cargan importándolo.

Administrar operarios pide ser admin del módulo; los contratistas, nivel de
edición: sumar a quien vino a hacer un trabajo es parte de registrarlo.

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

Enlaza los que reconoce y **avisa** los que no. Crearlos sola llenaría la lista
que Compras usa todos los días con cada variante de escritura que alguien tipeó
en una planilla.

Ese aviso se cierra y no vuelve, así que lo mismo vive en **Configuración →
Proveedores sin reconocer**: qué nombres usan las órdenes y no están en la
lista, cuáles parecen el mismo escrito de dos formas, y dos botones —sumarlos
todos, o sólo enlazar los que ya estaban—.

**Enlazar va aparte de sincronizar.** Completar `proveedor_id` no necesita
volver a leer las planillas, y la sincronización de comparativas borra y
reinserta: pasar por ahí para llenar una columna es caro y arriesgado sin
motivo.

## Lo que Compras gastó en cada máquina

Desde el 28/08/2026 el catálogo de ubicaciones de Compras apunta al núcleo: 15
ubicaciones son un equipo de este módulo y 13 son un sector de planta. La ficha
del equipo muestra abajo un bloque **"Compras para este equipo"** con el gasto
por año.

Dos cosas que la pantalla dice y conviene no perder:

- **El gasto de un sector no se reparte entre sus máquinas.** Atribuirle al
  `Molino vertical` una fracción de lo que se compró para Filler 2 sería
  inventar un número; se enlaza a Compras filtrado por sector en vez de
  simularlo.
- **"No se le compró nada" y "nadie enlazó su ubicación" no son lo mismo.** Sólo
  15 de las 239 máquinas tienen una ubicación que las nombre —son todas móviles,
  que es de lo que la planilla de Compras habla—, y las otras 224 lo dicen en
  vez de mostrar un cero.

Ver `docs/COMPRAS-ESTADO.md` para el mapeo completo y sus cuatro enlaces por
convención.

## El costo total de una máquina

El bloque de la ficha suma tres fuentes por año: materiales (Compras), terceros
(`ordenes_servicio.costo`) y mano de obra propia. El diseño está en
[specs/2026-08-28-costo-total-del-equipo](superpowers/specs/2026-08-28-costo-total-del-equipo-design.md).

**La tarifa de la hora se carga en Configuración** y cada tarifa dice desde
cuándo rige (migración 043). Una hora trabajada se costea con la que regía ese
día: con un solo valor mutable, subir la tarifa reescribiría lo que costó una
reparación de marzo. Sin ninguna cargada, la mano de obra no se muestra.

Cuatro cosas que se descubrieron al leer los datos y que no se deducen del
código:

- **`ordenes_trabajo.horas` es la duración del trabajo, no horas-hombre.** Las
  OT con tres operarios tienen la misma mediana que las de uno —3 horas—. Para
  costear hay que multiplicar por cuántos operarios figuran.
- **El 76% de las horas son de contratista** (11.222 de 14.808) y no se costean:
  las hizo un tercero y la OT no guarda cuánto salió. Parte de esa plata está en
  las OS, y **no hay enlace entre OT y OS** para saber cuánta.
- **`Ambos` no es una persona.** Aparece como operario en 59 OT (753 horas) y
  quiere decir "los dos", sin decir cuáles. Se cuenta como uno y subestima.
- **Ninguna máquina tiene hoy las tres fuentes.** Los móviles tienen materiales
  y terceros pero cero horas propias; las de planta tienen terceros y horas pero
  cero materiales, porque sus ubicaciones de Compras enlazan al sector y no a la
  máquina.

Lo que falta para cerrar el costo de verdad es el de las OT de contratista, y
eso necesita una columna de costo en `ordenes_trabajo` o un enlace OT ↔ OS: son
decisiones sobre cómo se registra el trabajo, no sobre cómo se lo suma.

## Lo que la app vieja tiene y el SdG todavía no

Relevado comparando las dos apps ruta por ruta, no de memoria.

| Falta | Qué es | Cuánto pesa |
|---|---|---|

## De un aviso sale una orden

El aviso es el primer eslabón: alguien vio que algo anda mal. Hasta ahora sólo
se podían traer de la planilla; ahora se cargan desde la app y de cada uno se
genera su orden de trabajo con un botón.

Las dos cosas escriben **primero en la planilla** —es la base y de ahí lee quien
no entra al sistema— y después acá.

**Los números salen de la planilla, no de la base.** Alguien pudo cargar un
aviso o una orden ahí desde la última sincronización, y tomar el máximo de la
base daría un número que ya existe. No es teórico: al escribir esto la planilla
de OT iba **cuatro órdenes adelante** de la base. Dos OT con el mismo número
dejan la escritura de vuelta apuntando a la fila equivocada.

La OT que nace de un aviso es **correctiva** —alguien reportó una falla, no es
un preventivo programado— y hereda la prioridad de la urgencia del aviso. El
aviso queda apuntando a ella de los dos lados: en el sistema con
`work_order_id`, y en la planilla con el número en la columna "OT ASIGNADA", que
es donde lo busca quien no usa la app. Eso es lo que evita que alguien genere
una segunda orden para el mismo problema.

Al cargar un aviso, elegir la máquina de la lista completa el sector solo: la
máquina sabe dónde está. Y las urgencias se escriben **con su emoji** —"🟠 Alta",
no "ALTA"— porque así están en la planilla, y dos vocabularios para lo mismo es
cómo la próxima lectura deja de reconocerlas.

## Los repuestos de una orden, y si los hay

La planilla de OT tiene **una sola columna de repuesto**, texto libre. Eso
alcanza para dejar una nota, no para saber qué hay que conseguir. La lista de
verdad vive en el sistema: nombre, código y cantidad de cada uno. No se escribe
en la planilla porque no tiene dónde.

**El stock se consulta en vivo**, contra la planilla del pañol, y no se guarda:
cambia cada vez que alguien retira algo, y una copia estaría desactualizada
justo cuando importa —cuando hay que decidir si el trabajo se puede hacer hoy—.

Cuatro distinciones que la pantalla hace y que no son lo mismo:

- **No hay stock** y **no está en el inventario**: una se compra, la otra se
  busca en otro lado o se pregunta en el pañol.
- **Cero** y **sin informar**: cero es un dato —no hay—; vacío quiere decir que
  nadie lo contó, y mostrarlo como cero manda a comprar algo que puede estar.
- **Hay** y **queda poco**: al mínimo o por debajo alcanza para este trabajo,
  pero hay que reponer.

Al escribir el nombre se busca en el inventario y se puede elegir de las
sugerencias, que es lo que hace que el **código** quede bien puesto: con el
código, la próxima vez se sabe si hay stock sin adivinar por el nombre. La
búsqueda parcial pide cuatro letras: con dos o tres, "de" o "tor" encuentran
media planilla.

**El inventario no lo maneja Mantenimiento.** Si su planilla no está configurada
o no se puede leer, la pantalla lo dice y sigue andando sin disponibilidad:
anotar qué hace falta no depende de saber si lo hay. Para conectarlo:
`GOOGLE_SHEETS_INVENTARIO_ID` y `GOOGLE_SHEETS_INVENTARIO_TAB`.

## La sincronización, sola

Había que acordarse de apretar el botón en cada pantalla, y lo que se veía en el
sistema era tan viejo como la última vez que alguien lo hizo.

Ahora lo llaman dos relojes, igual que Compras: **GitHub Actions cada quince
minutos**, que es la frecuencia real, y un **cron diario de Vercel** como red por
si Actions falla. El cron vive en Actions y no en `vercel.json` porque el plan
Hobby sólo admite crons diarios: poner una frecuencia mayor no degrada el cron,
hace fallar el deploy entero.

De paso se arregló un cron muerto: `vercel.json` llamaba todos los días a las 6
a `/api/cron/sync`, una ruta que nunca existió en este repo —quedó copiada de la
app vieja— y devolvía 404. Ese horario ahora es el de mantenimiento.

**El trabajo salió de las rutas.** Vive en `lib/mantenimiento/sincronizar.ts`
porque lo llaman dos cosas con permisos distintos: el botón, que exige sesión, y
el reloj, que no tiene ninguna. Mientras estuvo dentro de los handlers, el cron
no podía usarlo. Las cuatro rutas quedaron en veinte líneas: comprobar quién
pide y devolver lo que la función contestó.

**Una que falla no frena a las otras.** Que no se pueda leer la planilla de OS
no es razón para dejar los avisos sin actualizar. El cron las corre todas y
devuelve **207** si alguna falló: un 200 escondería el problema y un 500 haría
pensar que no se actualizó nada. Cada una registra su corrida —salga bien o
mal—, así que la pantalla puede decir cuál quedó vieja y por qué.

Verificado corriendo las cuatro: 138 avisos, 1.741 órdenes de trabajo, 221 de
servicio y 150 cotizaciones, en 21 segundos.

## El aviso desde la planilla

El cron trae todo cada quince minutos. El webhook es para no esperarlos: cuando
alguien edita una planilla, su Apps Script avisa y la app la relee.

Es **un solo endpoint para las cuatro planillas** y recibe cuál cambió en
`?recurso=`. Cuatro endpoints iguales serían cuatro lugares donde arreglar lo
mismo; así el Apps Script es el mismo archivo con una propiedad distinta en cada
planilla (`docs/mantenimiento-apps-script.gs`). Sin recurso corre las cuatro:
una planilla mal configurada tiene que traer de más, no de menos.

No viaja el contenido de la celda, sólo el aviso de que hubo un cambio. El
secreto es lo único que se manda.

**Hubo que dejarlo pasar por el middleware.** Todo lo que no sea `/api/cron/` va
al login, y un webhook no tiene cookie de sesión: sin la excepción, el Apps
Script recibía un 307 y no llegaba nunca. Se listan uno por uno a propósito
—dejar pasar todo `/api` abriría las rutas que confían en ese redirect—.

**Las OS nuevas no las va a traer el webhook.** Entran por un formulario de
Google que vive en otra planilla y llegan por `IMPORTRANGE`, y eso no dispara
"Al editar". Las trae el cron. Si hiciera falta que lleguen al toque, el mismo
script va en la planilla de respuestas del formulario, con el activador "Al
enviarse el formulario".

## El catálogo de tipos, editable

Dice qué lleva cada clase de máquina —qué rodamiento, qué lubricante, cada
cuánto— y es lo que se mira antes de abrir una. Se carga importando el libro BD
Equipos, pero **lo que se aprende reparando no vuelve al libro**: alguien
descubre que ese reductor lleva otro rodamiento y hasta ahora no tenía dónde
anotarlo. Ahora se edita desde Configuración.

Los treinta campos van agrupados como se los consulta —antes de abrir una
máquina uno mira los rodamientos, no las frecuencias— y no en el orden en que
están en la tabla. La lista blanca de columnas es **la misma** que usa la
importación: una sola, para que no se corran.

Al crear un tipo, el código tiene que ser el mismo que usa el libro. Si no
coincide, la próxima importación crea otro al lado.

## La foto del trabajo

Se sube al registrar una OT y queda guardada en **Supabase Storage**, no en
Drive.

**Por qué no en Drive.** Una cuenta de servicio de Google **no tiene cuota de
Drive**: subir un archivo falla con *"Service Accounts do not have storage
quota"* aunque la carpeta esté compartida como editor —probado contra la carpeta
de verdad, que sí da `canAddChildren: true`—. Sólo funcionaría contra una unidad
compartida o delegando en un usuario real. Por eso la app vieja necesitaba un
Apps Script desplegado aparte: corre con la cuota de una persona.

**El link y la planilla.** Dentro del sistema la foto se ve siempre. Para que el
link también sirva en la planilla —que la mira gente sin sesión— el bucket
`execution-photos` tiene que ser **público**; hoy es privado, así que se firma un
link que dura un año y la pantalla avisa que no se puede abrir desde la
planilla. Hacerlo público es una decisión de quien maneja los datos, no algo que
convenga cambiar de oficio.

## En qué orden hacer el trabajo

Hay dos órdenes y el manual gana. El **sugerido** sale de los datos —lo atrasado
primero, después el puntaje GUT (ver `## La matriz GUT`), después lo que espera
hace más— y el **manual** sale
de lo que sabe quien reparte el trabajo y los datos no: que el repuesto llega el
jueves, que conviene aprovechar que el sector está parado.

Se ordenan **sólo las pendientes**. De las 1.741 órdenes cargadas hay 32
esperando algo y 1.709 realizadas: poner en fila las que ya se hicieron no le
sirve a nadie, y además no se puede ordenar a mano una lista paginada de a
cincuenta.

Las que nadie tocó van después de las ordenadas, con el orden sugerido entre
ellas. Así poner tres arriba no obliga a ordenar las otras veintinueve. Si dos
quedan con el mismo número —pasa al ordenar una lista filtrada— desempata el
número de OT, que es estable.

Se arrastra, **y también hay botones de subir y bajar**: arrastrar no anda en el
teléfono, que es desde donde se mira esto parado al lado de la máquina.

El orden **no se escribe en la planilla**: es una decisión del día a día, no un
dato de la orden, y la planilla no tiene dónde ponerlo. Y se puede volver al
sugerido de una, porque si no la única forma de deshacer un orden viejo sería
arrastrar las treinta de nuevo.

## La matriz GUT: qué puntaje tiene una orden y cómo se ordena con él

Desde el 21/10/2026 cada orden de trabajo puede llevar tres notas de 1 a 5
—**gravedad, urgencia y tendencia**— y su producto, de 1 a 125, decide en qué
orden conviene atacarlas. El porqué, las escalas con sus palabras y lo que no
hace están en
[el spec](superpowers/specs/2026-10-21-mantenimiento-gut-design.md); lo de acá
son las trampas que no se deducen del código. La migración es
`20261021104750_gut_en_ordenes_de_trabajo.sql` y la lógica pura,
`lib/mantenimiento/gut.ts`.

**`gut_orden` es una columna generada y NO es el puntaje.** Es la clave con la
que ordena la base, y lleva adentro dos decisiones de ordenamiento: el 27 de las
órdenes sin puntaje y el +1000 de las que siguen abiertas. Una orden abierta sin
puntuar tiene `gut_orden = 1027`; una realizada con 4×5×4 tiene 80. Una pantalla
que la imprima muestra 1027 donde quiere decir "sin puntaje". **El puntaje es el
producto de las tres notas, se calcula en TypeScript con `puntajeGut()`, y es
`null` si falta alguna**: las tres van juntas o la orden cuenta como sin
puntaje.

**El 27 está escrito en dos lugares y tiene que estar escrito en dos.** En el
`coalesce` de la columna generada, para el orden que hace la base, y en
`SIN_PUNTAJE` de `gut.ts`, para el que hace el cliente (`ordenSugerido`, el
selector del plan). Cambiar uno y olvidar el otro no rompe nada: el listado y
"Qué hacer primero" empiezan a discrepar. `gut.test.ts` tiene un test que
reconstruye `gut_orden` con el 27 y el 1000 como **literales**, no como las
constantes del módulo: con las constantes, cambiar el valor movería los dos
lados juntos y el test pasaría igual. Si tocás el 27, ese test es el que tiene
que decirte que falta la migración.

**Una orden sin puntaje vale 27 y no 0**, porque con cero las pendientes sin
puntuar se irían al fondo de la lista y nadie mira el fondo. 27 es el centro de
la escala (3×3×3). Y **lo cerrado va al final**: el +1000 existe porque, sin él,
una orden realizada de 125 puntos quedaría para siempre arriba de todo, por
encima de la que entró hoy.

**El GUT no se exporta a ninguna planilla.** `prioridad` es la columna S de la
pestaña `OT`, que es parte del derrame de un `IMPORTRANGE`: un `PUT` ahí bloquea
el derrame o lo pisa el recálculo. Por eso el puntaje vive en columnas propias
que la sincronización nunca nombra: su `upsert` por `ot_number` arma el payload
desde `OrdenLeida`, así que el puntaje sobrevive a cada corrida. Quien no entra
al SdG no lo ve: es un **riesgo asumido**, y se revisa cuando las planillas se
den vuelta
([el spec](superpowers/specs/2026-10-19-las-planillas-las-llena-el-sistema-design.md)).
Lo que sí se lo lleva es el borrado de espejo: si la fila desaparece de la
planilla, la orden y su puntaje se van juntas.

**Tres consultas tuvieron que cambiar porque pedían una lista explícita de
columnas sin las `gut_*`**, y es la trampa de esta feature y la que más
probablemente muerda a quien la extienda:

- `app/api/mantenimiento/ordenes/reutilizar/route.ts`
- `app/(app)/mantenimiento/page.tsx` (el tablero)
- `app/(app)/mantenimiento/planificacion/[id]/page.tsx` (el selector del plan)

En las tres, de no traer las notas, **toda orden cuenta como sin puntaje**: el
orden no se mueve, el contador da 0 y el aviso de "el puntaje no se copió" nunca
se dispara. Sin error y con los tests unitarios en verde, porque lo que fallaba
era la consulta y no la función. Una cuarta se revisó y no lo necesitó: "Qué
hacer primero" usa `select("*")`. **Toda pantalla nueva que ordene o cuente por
GUT tiene que mirar qué columnas pide.**

Cómo queda el resto:

- **Se puntúa sólo desde el SdG**, nunca en el formulario de Google: de 2.227
  órdenes, 2.209 entraron por ahí y llegan sin puntuar. Se puntúa al crear
  (`NuevaOTModal`, `GenerarOTModal`), y sobre una orden ya cargada desde el
  listado y el detalle, por `PATCH /api/mantenimiento/ordenes/[id]/gut`. No
  audita: un puntaje se deshace escribiendo otro. Los tres desplegables arrancan
  **vacíos** y no son obligatorios.
- **Ningún camino de alta hereda un puntaje.** Aviso → OT no siembra
  `gut_urgencia` desde la urgencia del aviso (la puso quien reportó, el GUT lo
  contesta quien reparte), y Reutilizar OT no copia las notas y lo informa en
  `noEntraron`.
- **La `prioridad` de la planilla ya no ordena nada.** Sigue entrando, sigue en
  los filtros y en el detalle, pero `ordenSugerido` lee el puntaje. Y el
  recuadro del puntaje es un número con un solo tono en cinco intensidades, sin
  palabra: «alta/media/baja» ya son de `prioridad`, y los colores de estado ya
  están tomados.
- **"N de prioridad alta" del tablero nunca funcionó.** Comparaba contra
  `"ALTA"` lo que la planilla guarda como `"🟠 Alta"`, así que leía 0 desde
  siempre. Ahora `resumirAtrasadas().urgentes` cuenta las atrasadas de **GUT 65
  o más** y la leyenda dice «de GUT alto». Por la misma razón se sacó la pastilla
  `alta` de `OrdenarTrabajo`, que nunca se había dibujado.
- **La sugerencia de puntuar es una línea en la pantalla**, y no un aviso de
  `lib/home/avisos.ts`: iría a la campana y al push de las 8:30, y un contador
  que casi no se mueve termina descartado para siempre.
- **Mientras la migración no esté aplicada**, el listado, el tablero, el
  selector del plan y reutilizar fallan: piden columnas que no existen todavía.
  Se aplica antes de desplegar.

## Las órdenes atrasadas

Una orden está atrasada de dos maneras y las dos cuentan: que la planilla la
haya marcado `ATRASADO` a mano —lo decide una persona— o que se le haya pasado
la fecha en que tenía que hacerse —lo decide el calendario—.

Lo que **no** cuenta: una realizada, aunque se haya hecho tarde, porque ya no
hay nada que hacer con ella; y una suspendida, que se paró a propósito y
avisarla todos los días es ruido.

Se muestran **en el tablero**, arriba y sólo cuando hay: un panel que dice "cero
atrasadas" todos los días enseña a no mirarlo, y el día que diga otra cosa nadie
lo va a ver. Van agrupadas por sector porque es como se resuelven —las cuatro de
Calcinación son un problema de Calcinación, no cuatro problemas sueltos— y con
un link a la lista ya filtrada.

**Hoy son diez, todas marcadas a mano y ninguna con fecha de vencimiento.** Por
eso el panel dice "sin fecha" en vez de inventar los días: la planilla no dice
desde cuándo. La parte de "se pasó la fecha" queda lista para los preventivos
programados, que sí la usan.

El aviso queda **dentro de la app**: no sale por mail ni por push. Lo ve quien
entra a mirar. Si hiciera falta que llegue solo, la lógica ya está separada en
`lib/mantenimiento/alertas.ts` y sirve igual para cualquier canal.

## La programación semanal del taller (26/10/2026)

`/mantenimiento/programacion`: la semana del taller mecánico y del eléctrico —tres
turnos por siete días—, los huecos que dejan las ausencias y quién puede
taparlos. Hasta ahora la armaba el encargado de memoria y no existía escrita en
ningún lado. El diseño, con lo que se midió, está en el
[spec](superpowers/specs/2026-10-22-mantenimiento-disponibilidad-y-turnos-design.md)
y el recorrido de la construcción en el
[plan](superpowers/plans/2026-10-23-mantenimiento-programacion-del-taller.md).
Lo que sigue es lo que **no se deduce del código**.

**Qué hay.** Tres tablas (`20261023105615`) y un índice único
(`20261026084938`): el padrón `mant_personal_taller`, la semana de referencia
`mant_programacion_referencia` y las pisadas `mant_programacion_pisadas`. La
cuenta vive en `lib/mantenimiento/programacion.ts` (la rotación) y
`lib/mantenimiento/disponibilidad.ts` (el cruce con las ausencias y los
candidatos), todo funciones puras con sus tests. Cinco rutas bajo
`/api/mantenimiento`: `programacion` (la semana), `programacion/pisadas`,
`programacion/referencia`, `personal` (el padrón) y `ausencias` (la carga del
encargado). No hay planilla de Google de ningún lado: nace adentro y se queda
adentro, como Ensayos.

### Son dos ciclos, y el cuadro entero se repite a las **6** semanas

No a las 2 ni a las 3. Los dos grupos de mecánicos se dan vuelta cada semana
entre 4-12 y 12-20, así que su ciclo tiene **período 2**; los tres electricistas
avanzan un turno por semana y vuelven al que tenían a las 3, **período 3**. El
cuadro completo recién coincide consigo mismo en el mínimo común múltiplo: 6.
Modelar "la rotación" como un solo ciclo da bien las primeras dos semanas y mal
después, sin un error que lo diga. Hay un test que mira las seis semanas contra
el cuadro que se validó con el encargado, y otro que exige que ninguna de las
semanas 2 a 6 sea igual a la primera y que la séptima sí. El 8-16 no lleva
mecánicos: sólo electricista.

**La rotación no se guarda, se calcula.** No hay una tabla con la grilla de cada
semana: sale de la referencia y de la cuenta, hacia adelante y hacia atrás. Por
eso las semanas anteriores a la referencia se pueden mirar, y por eso importa un
detalle de JavaScript: `-1 % 3` es `-1` y no `2`, así que la distancia en
semanas se normaliza antes de indexar. El test lo ejercita en -1 y en -2, porque
con -1 solo no se distingue una normalización que falta de una mal hecha.

**Qué ancla rige una semana.** No la más nueva a secas, sino la más nueva que no
sea posterior a esa semana. Si alguien vuelve a anclar el ciclo, las semanas ya
pasadas se recalcularían con el ancla nueva y cambiaría lo que el encargado vio
en su momento. Antes de la primera ancla se toma la más vieja y se extrapola
hacia atrás. Y para que "la más nueva que no sea posterior" tenga una sola
respuesta, **no puede haber dos anclas del mismo lunes**: la ruta lo chequea
leyendo antes de escribir, y eso no alcanza —dos envíos simultáneos pasan los
dos—, así que la garantía es el índice único `20261026084938`. Sin él, la
pantalla elegía entre las dos de forma indefinida y cambiaba **todas** las
semanas desde ese lunes sin dar un error.

**El padrón lleva vigencia (`desde`/`hasta`) y no es opcional.** Una semana
pasada se arma con el padrón que regía entonces; si alguien entra, se va o
cambia de grupo, recalcularla con el padrón de hoy reescribiría lo que se vio.
Es la misma razón por la que la tarifa hora tiene historia. El oficio no está en
`empleados` —mecánico, electricista y lubricador son oficios, no sectores— por
lo que ya dijo la migración `20260903090920` del pañol.

**Las pisadas son por día.** La rotación es semanal pero las faltas son por día
(la gente de Mantenimiento trabaja 27 de 33 sábados), así que cuando el
encargado mueve a alguien para tapar un hueco lo mueve ese día, y las semanas
siguientes siguen saliendo del ciclo. El `unique (empleado_id, dia)` impide que
una persona quede en dos turnos el mismo día.

### De dónde salen las ausencias, y qué se deja afuera a propósito

De `ausencias` y de `francos`, las dos tablas de RRHH. Tres decisiones que
parecen omisiones y no lo son:

- **Un franco abre hueco por `fecha_descanso`, nunca por `fecha_tomado`**, y la
  distinción es el arreglo del 26/10/2026. `fecha_tomado` es **el día en que
  alguien apretó el botón** de "tomado": hasta esa fecha la pantalla mandaba
  `hoyEnArgentina()` a mano, así que de 217 francos los 56 tomados caían en
  **tres días**, 35 de ellos el 01/09/2026 — tres sesiones de alguien
  poniéndose al día, no tres días en que descansó medio taller. Cruzar por ahí
  habría pintado 35 huecos un lunes cualquiera.
  Desde el 26/10/2026 marcar un franco **pide el día que se descansa** y lo
  guarda en `fecha_descanso`, que es el que este cruce mira. Se puede pedir
  porque el franco se marca **cuando se formaliza**, así que el día ya se sabe
  y casi siempre está adelante.
  **Los 56 viejos quedan con `fecha_descanso` en null y no abren hueco**: su
  día real no quedó escrito en ningún lado y se dieron por perdidos a pedido.
  Null es la verdad ahí —el sistema no sabe— y es la misma regla que el
  proyecto aplica en las planillas: enlazar al que se le parece es peor que
  dejar en null. Comprobado contra la base el 26/10/2026: filtrando por
  `fecha_descanso`, la semana del 01/09 devuelve **cero** filas.
  Lo que pregunta la programación es `noViene()` de
  `lib/mantenimiento/disponibilidad.ts`, que junta las dos razones —ausencia
  cargada y franco que se descansa— en un solo lugar, para que la grilla y los
  candidatos no puedan calcularlas distinto.
- **`TARDANZA` no cuenta como falta.** Está en el mismo enum que `VACACIONES`,
  pero quien llega tarde viene a trabajar: pintarlo como hueco muestra un
  agujero donde hay una persona, y la primera vez que pase el encargado deja de
  creerle a la pantalla. Hoy no hay ni una en las 144 ausencias; la exclusión es
  una defensa para el día en que se cargue la primera. Los otros once tipos sí
  cuentan, justificados o no.
- **`vacaciones` no se lee.** Las vacaciones entran como una `ausencia` de tipo
  `VACACIONES` y la ruta sincroniza la fila de `vacaciones` desde ahí; leer las
  dos contaría lo mismo dos veces.

**El hueco dice que no está, no por qué.** `ausencias` está cerrada con
`tiene_acceso_rrhh()` y `ENFERMEDAD_ACCIDENTE_INCULPABLE`, `LICENCIA_ART` o
`SUSPENSION` son dato médico y disciplinario. El cruce lee con el cliente admin y
devuelve un booleano por persona y día; no se abrió ninguna policy sobre
`ausencias` porque eso expondría las 70 fichas y no las nueve.

### Por qué el encargado carga las ausencias, y cómo se le deja

**Medido sobre las 144 ausencias cargadas: la mediana entre el día en que
empieza la ausencia y el día en que alguien la carga es de 39 días tarde, y una
sola se cargó con un día o más de anticipación.** Una pantalla que sólo lee lo
que RRHH cargó no avisaría nada: mostraría la semana limpia y los huecos
aparecerían cuando ya pasaron. Por eso la carga del encargado, en el momento en
que el operario le avisa y desde el teléfono, **es la puerta principal por la que
entra el dato** y no un accesorio, y la pantalla se armó alrededor de eso.

La ruta es `POST /api/mantenimiento/ausencias` y escribe con el cliente admin,
así que **ahí no corre RLS: lo único que lo separa de las fichas de los 70
empleados son los chequeos del archivo**. Son el nivel de edición en
Mantenimiento, que la persona esté en el padrón y vigente todo el rango, y que
el tipo sea uno de cuatro (`PERMISO_PERSONAL`, `ENFERMEDAD_ACCIDENTE_INCULPABLE`,
`INJUSTIFICADA`, `OTRA`; `altaDeAusencia` NO restringe, valida contra los doce de
la base). Tres cosas más, que son las que evitan un daño:

- **Dar de alta no es insertar una fila.** El cuerpo se sacó de la ruta de RRHH
  a `lib/rrhh/altaDeAusencia.ts` y lo comparten las dos puntas, porque después
  del insert hay que sincronizar vacaciones y recalcular `calculos_diarios`. Una
  ruta que sólo insertara dejaría una ausencia visible que la liquidación no ve,
  y eso se nota en el sueldo de alguien.
- **Un período liquidado no se toca**: se rechaza con un 400. El agujero
  —`recalcular.ts` no mira `estado_liquidacion`— sigue del lado de RRHH, que no
  se tocó en este proyecto; lo que se evitó es agrandarlo.
- **Sólo se corrige o se borra lo que cargó el que pide** y de uno de esos
  cuatro tipos. Corregir y borrar **se auditan** (`corregir`, `borrar`) y el
  registro va **antes** del cambio: si no entra, no se hace, porque `ausencias`
  no tiene historial y lo que se pierde no se reconstruye.

### Quién la ve, y lo que no hace

La pantalla y las tres tablas se cierran a **admin de Mantenimiento**
(`mant_es_admin()`), que es el nivel que ya existía para configurar catálogos y
el padrón es un catálogo. El encargado pidió que no la vea nadie más y eso no
existe como permiso: **la ve todo el que tenga admin de Mantenimiento, hoy
incluido cualquier `admin_sistema`**. Si mañana hay dos con admin y uno no debe
verla, hace falta una marca en el padrón o un nivel nuevo; inventarlo hoy para
una persona sería construir un mecanismo que nadie pidió.

No decide nada solo: **sugiere** quién tapa un hueco con dos criterios, que sea
del mismo oficio y que no esté ya trabajando ese turno. No equilibra, no puntúa y
no modela cuánta anticipación hubo. El turno de 20 a 4 no existe en este diseño
(no tiene operarios designados) y los feriados no tienen trato especial. La
palabra "turnos" ya estaba ocupada: `/rrhh/turnos` es el catálogo de horarios con
tolerancia con el que el motor de RRHH **adivina el turno a partir de la
marcación**, que va al revés; por eso esto se llama *programación* y no toca
`jornadas`.

### Estado

**Falta cargar la semana de referencia** (la tabla estaba vacía al cerrar esto,
26/10/2026): hasta que el encargado la cargue, la pantalla muestra el padrón y
dice que falta la referencia, sin grilla. La migración `20261026084938`
**la corre una persona a mano** en el editor SQL; si para entonces alguien cargó
dos anclas del mismo lunes, falla al crear el índice y hay que borrar una a mano.

### Lo que ningún test pudo verificar: hay que abrirlo

Esta pantalla **nunca se abrió en un navegador**, porque todo está detrás del
login. La lógica pura tiene tests, las rutas se ejercitaron contra la base real
llamando a los handlers, y el escaneo responsive pasa — pero nadie la vio. Lo que
hay que mirar, en orden de lo que más duele si está mal:

1. **La referencia, antes que nada.** Es el único camino de escritura que ningún
   test ejercitó end-to-end desde la pantalla, y de él sale toda la grilla.
   Cargarla y **verificar con el encargado que la semana que muestra es la que
   él dice que es**, antes de darla por buena. Si queda mal, se corrige desde la
   misma sección —para eso se hizo—, pero el error no avisa: la grilla se ve
   perfectamente bien y dice gente en turnos en los que no está.
2. **Cargar el padrón primero**, las nueve personas con su oficio y su grupo. El
   desplegable de empleados tiene 70 opciones, así que tiene que abrir el panel
   con buscador y no la rueda nativa.
3. **Anotar una falta desde un hueco, en un teléfono de 375 px.** La promesa son
   dos toques: la persona y el tipo. Y que el "Deshacer" del aviso la saque.
4. **"Otra"** pide el motivo y no deja anotar sin él.
5. **Pasar a alguien de turno y volverlo al ciclo**, y que la marca aparezca y se
   limpie.
6. **Corregir y sacar una falta propia**, y abrir una que cargó RRHH: ahí no
   tiene que verse el motivo ni los botones. Es el límite de privacidad visto
   desde afuera.
7. **La tabla de siete días a 375 px**, que scrollea de costado sin empujar la
   página.
8. **Una semana anterior y una posterior a la referencia**, con las flechas.

### Tres cosas chicas que quedaron sabidas

Ninguna rompe nada; están acá para que quien las vea no crea que descubrió un
bug nuevo.

- En la sección de la referencia, **«Lo que rige hoy» es la ancla más nueva**, y
  nada impide anclar hacia adelante. Si alguien carga un ancla con un lunes
  futuro, esa etiqueta nombra algo que todavía no rige. Al lado está el lunes
  impreso, así que se lee raro y no falso.
- **Corregir un ancla también puede moverle la semana**, que es lo que el PUT
  hace a propósito; el cartel rojo lo avisa, pero el diálogo de confirmación
  nombra el lunes nuevo y no el que se deja vacío.
- **Borrar una ausencia futura deja sus días marcados como ausente** en
  `calculos_diarios` después del recálculo. Es anterior a este trabajo y es de
  RRHH, no de acá.

## El cuaderno de Piparo: leer una foto y sacar las OT (01–02/11/2026)

Piparo entrega su mes en un **cuaderno manuscrito** y no con partes preimpresos
como Candia. De ahí salen unas 35 OT por mes cargadas a mano, mientras que el
cuaderno tiene unos 118 renglones: lo que no se cargaba, no existía. Esto lee las
fotos con un modelo, deja los renglones para chequear contra el papel y genera
las OT. El diseño está en el
[spec del 30/10](superpowers/specs/2026-10-30-mantenimiento-cuaderno-de-piparo-design.md)
y el plan en
[docs/superpowers/plans/2026-11-01-mantenimiento-cuaderno-de-piparo.md](superpowers/plans/2026-11-01-mantenimiento-cuaderno-de-piparo.md);
acá está lo que no se deduce del código y lo que se midió cuando por fin hubo
una foto real.

**Dónde vive.** La pantalla es `/mantenimiento/partes-contratista` (la misma
ruta que Candia; `CuadernoClient.tsx`), las rutas están en
`app/api/mantenimiento/cuaderno/` (`fotos`, `renglones`, `repetidos`, `generar`),
la lógica pura en `lib/mantenimiento/cuaderno*.ts`, y las tablas son
`mant_cuadernos`, `mant_cuadernos_fotos` y `mant_cuadernos_renglones` más el
bucket privado `cuaderno-contratista` (10 MB, creado por SQL en la primera
migración).

### El modo lo decide `proveedores.modo_de_carga`

El desplegable de contratista elige la pantalla: **PIPARO está en `cuaderno` y
CANDIA en `parte_diario`**. Lo decide esa columna y no el nombre ni un id en una
constante, así que el tercer contratista con cuaderno es un `update` y no un
deploy. Lo que hay que saber: `ordenes_trabajo.contratista` es **texto** y no
una FK, y el nombre del proveedor tiene que coincidir con él (medido: `PIPARO`
exacto en el proveedor y en las 380 OT). El freno de los duplicados compara
por ese texto, sin distinguir mayúsculas.

### Lo que se midió contra el papel real (02/11/2026)

Hasta acá todo se había probado con respuestas del modelo inventadas, y esa fue
la excusa para no ver el papel: la pantalla está detrás del login. Se hizo de
otra manera, **en sólo lectura**: un script llamó a `generateObject` con
`esquemaDeLaLectura` y `PROMPT_DEL_CUADERNO` tal como los usa la ruta, le pasó
cada una de las diez fotos de septiembre de 2026, y puso el resultado por
`normalizarRenglones`, `engancharRenglonLeido` contra los **41 sectores y 269
equipos reales**, y `enOrdenes`. No escribió nada en la base ni en el bucket.

**Lo primero: con la llave de `.env.local` no se puede probar el modelo que
manda.** `anthropic/claude-sonnet-5` devuelve **403 `RestrictedModelsError`**
("Free tier users do not have access to this model") antes de llegar al modelo,
igual que `claude-sonnet-4.6`, `claude-sonnet-4.5` y `claude-haiku-4.5`. Todo lo
que sigue se midió con **`google/gemini-2.5-flash`**, el único de los probados
que entra en el tier gratuito. **Eso no dice cómo lee Sonnet 5**: la letra de
Piparo es justo donde más se nota la diferencia de modelo. Lo que sí vale
igual es lo que depende del papel y del código, no del modelo.

| | |
|---|---|
| Diez páginas | **140 renglones** (el spec calcula ~118), 28 OT saldrían y el resto queda pendiente |
| Tiempo por página | 15 a 49 s, **salvo la 6: 201 y 214 s en dos corridas** (62.911 tokens de razonamiento sobre letra ilegible), a 26 s del tope de 240 s de la ruta |
| Página 2 (la del 21–23/09) | 15 renglones, las dos veces; 24 y 41 s |
| Enganche de esa página | 11 de 15 con sector, 5 con equipo, 4 en rojo (en la segunda corrida: 10, 4 y 5) |
| Las diez | 37 de 140 con sector y **103 en rojo, con el catálogo de PIPARO vacío** (hay 23 lugares aprendidos y son todos de Candia) |

**El rojo de la primera carga es sobre todo un catálogo vacío.** El 74% en rojo
(103 de 140) **no es el código fallando**: es un catálogo de PIPARO que nadie
enseñó todavía y un modelo que en las páginas 3 y 8 leyó «P/suls tut N°L» donde
dice «P/Trit N°1». Al lado está la página 2, donde la letra es legible y los
lugares son los de siempre: **11 de 15 con sector** con el mismo catálogo
vacío. La diferencia entre las dos cifras es la letra y no el enganche; y cada
sector que alguien confirma queda aprendido, así que la segunda carga arranca
con menos rojo que la primera. «Horno 4 Rastro» queda en rojo porque ninguna abreviatura nombra
los hornos —el sector es Calcinación, `PO-B1`— y es justo lo que el catálogo
aprendido está para absorber.

**Qué leyó bien, en la página 2**, que es la que el spec transcribe: las horas
y los pesos (`= 920000` salió como 920.000 pesos y no como horas; `= 4` sin
unidad quedó `unidad: null` y entró dudoso), las **dos llaves** con su total
en un solo renglón y `en_llave` en todos, las comillas expandidas y marcadas
`heredado`, y el sector de los renglones que nombran una planta. `Tranqueras
D6` salió con equipo D6, sector **Cantera** y `sector_propuesto`, que es lo que
decidió el Ruling 2 del plan.

**Qué leyó mal o raro, y qué quedó sin red:**

- **El encabezado del primer día está pisado a mano en el papel** (un dígito
  escrito sobre otro). El spec lo lee 21; el modelo leyó **24, las dos veces, sin
  marcarlo dudoso**. Nada del sistema avisa que el orden de los días quedó 24,
  22, 23: las OT de ese día saldrían con otra fecha.
- **El 23/09 salió «27» en una corrida y bien en la otra.** Con `temperature: 0`
  la misma foto da dos lecturas distintas, y eso no se arregla con código: es la
  prueba medida de por qué la pantalla pone **la foto fija al lado de los
  renglones** (el 21 se leyó 24 las dos veces, el 23 se leyó 27 y 23), y por qué
  la ruta se niega a releer una página que ya tiene renglones.
- **La página trae un tercer día que el spec no transcribe** (23/09, una llave de
  24 Hs) **y una línea entera tachada.** El prompt, que usa esa misma hoja como
  ejemplo, tampoco las nombra: el modelo la devolvió como renglón dudoso en
  una corrida y no la devolvió en la otra. Falta decidir qué es una línea
  tachada, y no se resolvió acá porque no se puede validar contra Sonnet 5.
- **La comilla se expandió a medias**: «Reparar rodillos 5 P/Trit N°1» perdió el
  «2/cinta», así que la cinta 5 de ese renglón quedó sin equipo.
- **`linea` no es el número de renglón.** En una corrida el modelo contó las
  líneas físicas del papel, encabezados incluidos, y en la otra no. Sirve para
  volver a la foto y para ordenar dentro de un día, no para contar.
- **Un número se pegó a su unidad: «= 18 Hs» salió `1845` horas** (página 9,
  «Cartelería P/Trit N°3»), y entró sin ninguna marca: sin eso, confirmar sin
  mirar daba una OT de 1.845 horas. **Se arregló ahí mismo**:
  `normalizarRenglones` marca dudoso todo renglón de más de **200 horas**
  (`TOPE_DE_HORAS_POR_RENGLON`), nombra el número en el motivo y lo deja entrar
  igual —nada se descarta ni se redondea—. El 200 está medido: lo más grande
  que trae el cuaderno es una llave de 46 h, y después 40, 38 y 32. **A los
  pesos no se les pone tope**: un importe grande es normal.
- **El año se leyó «24» en diez renglones de la página 11** y el mes entero se
  corrió a 2024. Ese sí lo atajó `normalizarRenglones`: «cae fuera del mes de la
  carga» y quedó dudoso. Es la única validación de fecha que hay, y funcionó.

**Lo que se sabe y no se probó.** La pantalla, la subida, la reducción en el
cliente, el desplegable de equipos con 269 opciones, la vista previa y la
generación están detrás del login y no se ejercitaron: lo que hay son las
funciones puras y la lectura del modelo. **Falta una corrida real de `simular`
desde la pantalla antes de la primera generación**, y esa primera generación
no puede ser septiembre (ver más abajo).

### Las trampas que cuestan caro

- **El costo vive en dos lugares y nadie los ata**: `ordenes_trabajo.costo` es un
  número en la base, y el mismo monto va escrito dentro del texto de
  `REPUESTO UTILIZADO` (columna I de la planilla). La planilla no tiene columna de
  costo y es de donde lee quien no entra al sistema, así que se usó la que ya
  existía: de las 380 OT de PIPARO, **58 ya traían el monto escrito a mano ahí**,
  de tres formas distintas. Si alguien edita uno y no el otro, divergen. Y
  **`costoEquipo.ts` no suma este costo**: ese informe saltea toda OT con
  contratista, y se decidió no tocarlo. Todo lo que se le pagó a Piparo era
  invisible para el costo de la máquina y lo sigue siendo.
- **La columna I del master es derrame y no guarda lo que se le escribe.** Es el
  resultado de un `QUERY(IMPORTRANGE())` del libro de respuestas; escribirle
  bloquea el derrame con un `#REF!` o lo pisa el próximo recálculo, y la
  sincronización le devuelve a la base el texto viejo. Por eso, **al sumar horas
  a una OT que ya existe se corrige en «Altas del sistema»** —de ahí derrama—
  con `corregirLaAlta`, y **antes** de tocar la base: si Google falla, no se
  toca nada. Vale para la H (descripción) y la J (fecha de ejecución) también, y
  sólo para las OT que creó el sistema: las del formulario no están en esa
  pestaña. Quien agregue otro campo editable que viaje por H, I o J pasa por la
  misma puerta.
- **Septiembre de 2026 ya está cargado a mano: 29 OT de PIPARO, 28 fechadas el
  01/09.** Generar el cuaderno de septiembre las duplica, y una OT escrita en la
  planilla se borra a mano, fila por fila. Hay un freno: la generación **se
  niega con un 409** si el mes del cuaderno ya tiene OT del contratista que no
  salieron de ningún cuaderno, y se levanta con `confirmar_duplicados: true`. Mira
  **el mes entero y no el rango de los renglones**: con el rango justo, un
  cuaderno que arrancaba el 02/09 no atrapaba las 28 del 01/09, que son
  justo las que motivaron el freno. La vista previa (`simular`) no se niega:
  informa. Una segunda corrida de la misma carga no se frena a sí misma, porque
  lo que generó el sistema está enlazado a renglones. **La prueba real no
  puede ser septiembre**: hay que usar un mes sin cargar.
- **`en_llave` no existe como columna.** Se lo pide al modelo y se lo usa al
  normalizar, pero no se guarda: cuando se agregó el campo no se pidió una
  cuarta migración. Consecuencia, y es la más fea de la prueba real: **una llave
  que nadie junta no se frena.** Las 46 h de la página 2 están escritas en
  «Limpieza P/Trit N°1»; ese renglón tiene sector y horas, así que **sale como
  una OT de 46 h por sí solo**, y los otros dos de la llave quedan
  pendientes (`sin_sector` o `sin_horas`). Las horas están bien y las tareas
  mal repartidas, sin ninguna marca. Los que quedaron en blanco de una llave se
  ven en los pendientes, no en una advertencia de «esto venía de una llave».
  **Es el comportamiento pedido y queda como riesgo asumido, no como defecto**:
  quien carga decide si las junta, y la vista previa lo muestra antes de crear
  nada.
- **Primero se juntan los renglones, y después se confirma el sector.** Al
  revés, confirmar le saca al renglón el estado «sin sector confirmado» y con eso
  **sale de la propuesta de acumulación** (`propuestaDeGrupos` sólo mira los
  que no lo tienen confirmado): «Tranqueras D6» del 17, el 21 y el 23 dejan de
  proponerse juntas y salen como tres OT. Tampoco se hereda: un grupo sale sólo
  si **todos** sus renglones traen sector y ninguno propuesto.
- **Una foto leída no se relee.** Pisaría lo que una persona corrigió en
  pantalla, y como el modelo no da lo mismo dos veces, tampoco sería la misma
  lectura. Reintentar sólo vale para una foto que quedó en `fallo`.
- **Lo dudoso no frena nada**, sólo pinta y tiene su filtro. Lo que frena la
  generación es la falta de sector, de fecha o de horas y precio.
- **Una OT sin equipo no es un error**: `equipment_id` admite null (118 de 156
  OT de Candia lo tienen) y `equipo_raw` va como `<código del sector> - Edificio`,
  la misma convención que la generación de Candia.

### Lo que hay que tener en Vercel

`AI_GATEWAY_API_KEY` tiene que estar cargada (está en Production y Preview desde
el 05/10/2026 por el Asistente). **Con una llave del tier gratuito la lectura
falla con el 403 de arriba**, y se ve en la foto como `fallo` con lo que dijo el
Gateway sin traducir; no sé si la cuenta de producción tiene saldo, y comprobarlo
es la primera foto que se sube. `CUADERNO_MODELO` es **opcional**: sin ella usa
`anthropic/claude-sonnet-5`. Se carga para probar la cañería sin créditos
(`google/gemini-2.5-flash` anduvo) y **la calidad de la lectura no se juzga con
ese modelo**. Borrarla vuelve al bueno.

Cada foto es una llamada de hasta 240 s dentro de una función de 300, y se mandan
de a una: una página lenta como la 6 no tumba a las otras nueve. **Pero el margen
es de 26 segundos**: con Gemini, una página densa tardó 201 y 214 s contra el
corte de 240, y las otras nueve entre 15 y 49. Una página así puede quedar justo
del lado equivocado y terminar en `fallo`; se reintenta. Con un modelo que no
razona tanto no debería pasar, pero no se pudo medir.

### La otra puerta: el mes en un Excel (02–03/11/2026)

**No todos los meses vienen en el cuaderno.** Quien carga arma a veces la
planilla él mismo, y en ese caso fotografiar lo que ya está tipeado para que un
modelo lo vuelva a leer es dar una vuelta entera para perder exactitud —y mete
los dudosos de la letra manuscrita en un dato que nunca fue manuscrito—. Así que
un mes puede entrar por un `.xlsx` **como alternativa a las fotos**, no como
otro modo: los renglones quedan iguales y todo lo de abajo —el enganche a sector
y equipo, juntar y separar, confirmar el sector, el freno de duplicados,
generar— no se entera de por dónde entraron.

#### Las cinco columnas que se procesan

| Columna | Obligatoria | Qué es |
|---|---|---|
| **Tarea** | **sí** | Qué se hizo. Es lo que va a la descripción de la OT |
| **Fecha Desde** | no | El primer día |
| **Fecha Hasta** | no | El último. Vacío quiere decir que duró un día |
| **Hs** | **sí** | Las horas de esa tarea |
| **Precio ($)** | no | Lo que se cobra por trabajo, cuando no se cobra por hora |

**Se buscan por el texto del encabezado, no por la letra de la columna**, y eso
no es comodidad. El 02/11/2026 este mismo contenido vivía en `K` a `O` —era el
resumen de la derecha de una planilla que además traía el detalle día por día a
la izquierda— y el 03/11 pasó a `A` a `E` al quedar la tabla sola. Leer por
letra significa que mover la tabla una columna rompe la carga sin decir por qué.
Se aceptan también `Descripción`, `Desde`, `Hasta`, `Horas` e `Importe`, y una
sola columna `Fecha` se toma como el día en que empieza.

**Una fila es una tarea y una tarea es una orden de trabajo.** No hay nada que
agrupar: quien arma el archivo ya hizo la consolidación. Juntar y separar a mano
siguen en la pantalla para el caso raro.

#### Seis cosas que no se deducen del código

- **El control es la fila de TOTALES**: sus horas tienen que dar la suma de las
  filas. Medido sobre el archivo real, ese total está **escrito a mano y no es
  una fórmula**, así que compararlo no es redundante — es lo que detecta una
  fila tipeada de más, una de menos o un dígito cambiado. **Si no da, los
  renglones entran igual**: no hay nada que retener, la tabla *es* el dato. Se
  dice fuerte, con los dos números y la diferencia. Si no hay fila de TOTALES,
  también se avisa: no hay contra qué comparar.
- **El Excel guarda «Fecha Hasta» tal como viene, aunque sea igual a la
  «Desde».** La primera versión guardaba null cuando las dos coincidían —«duró
  un día», más prolijo— y estaba mal: de las 63 filas del archivo real, **45
  quedaban con el campo vacío en pantalla, que es indistinguible de un dato que
  se perdió**, y quien había tipeado las 63 fechas lo notó enseguida. Null
  significa ahora que la celda no traía nada. (Los ~1.400 renglones que
  entraron por foto siguen con null y tampoco les falta: una línea del cuaderno
  manuscrito es de un día.) El código lo lee como `fecha_hasta ?? fecha`
  (`totalesDeRenglones`), que es lo que hacía antes de que la columna existiera
  (migración `20261103083610`).
- **No hay check de que `fecha_hasta >= fecha`.** Un rango dado vuelta es un
  error de quien tipeó y hay que **mostrárselo**: el intérprete lo marca dudoso
  con su motivo y el renglón entra. Un check en la base haría fallar el insert
  de las 63 filas por una.
- **Que una carga sea de Excel no lo dice ninguna columna: lo dice la extensión
  de la ruta** (`esRutaDeExcel` en `lib/mantenimiento/cuadernoOrigen.ts`). El
  archivo va al mismo bucket y a la misma tabla (`mant_cuadernos_fotos`, con
  `orden: 1`) justo para que la procedencia de cada renglón, el borrado de la
  carga y el freno de duplicados sigan funcionando sin tocarse. Eso evitó una
  migración de columna; la que sí hubo es `20261102115445`, porque
  `allowed_mime_types` del bucket sólo tenía los cinco tipos de imagen y **subir
  el `.xlsx` sin ella falla con un error de Storage que no explica nada**.
- **No se mezclan fotos y planilla en una misma carga**, y la guarda está en las
  dos rutas y no sólo en la pantalla: el `accept` de un campo de archivo no
  impide elegir nada.
- **`lib/core/excel.ts` no sirve para leerlo y por eso hay otro lector.** Ese
  aplana cada celda a su valor, que es lo que quieren los cinco importadores que
  lo usan. Acá esa diferencia se usa para no mentir: una celda de horas que es
  una fórmula **sin resultado calculado** no es un cero sino un archivo que Excel
  no recalculó, y un `#REF!` no es una celda vacía sino una referencia rota. El
  lector propio es `cuadernoExcelArchivo.ts`, separado del intérprete
  (`cuadernoExcel.ts`, puro) para poder probar las decisiones sin armar un
  `.xlsx`.

#### Lo que se midió (03/11/2026, `Tareas_Octubre_2026 2.xlsx`)

Una hoja, 63 tareas, **1074 horas, y la fila de TOTALES dice 1074: cierra
exacto**. La tarea más larga son 106 h y 18 de las 63 abarcan más de un día. 0
precios. Un solo dudoso: **la fila 24 trae `#REF!` en «Fecha Desde»** —una
referencia que quedó rota al sacar el detalle— y entra igual, marcada, usando su
«Fecha Hasta». El tope de horas por fila es **500**: el error probable tipeando
es el dígito de más (106 → 1060), y 500 lo atrapa dejando casi cinco veces el
máximo visto de margen. No es el mismo número que `TOPE_DE_HORAS_POR_RENGLON`
(200) ni tiene por qué serlo: allá una fila es un renglón de un día del cuaderno
manuscrito, acá es una tarea entera a lo largo del mes.

En pantalla, una carga de Excel **no muestra el panel de la foto**: no hay hoja
contra la cual comparar. En su lugar van las cinco columnas que se leyeron, de
qué fila salió cada renglón, y dos campos de fecha por renglón en vez de uno. El
filtro de «dudosos» **se dejó**, aunque el plan decía sacarlo: el Excel también
produce dudosos —un `#REF!`, una fecha que no existe, unas horas que no son un
número— y esconderlos sería tapar problemas reales.

**Hay además un filtro por sector, y existe para poder juntar** (03/11/2026).
Con 63 tareas sueltas, juntar las que van en una misma OT obligaba a buscarlas a
ojo por toda la lista. El desplegable lista **sólo los sectores que esa carga
tiene**, con cuántos renglones cada uno, más «sin sector»; se combina con los
chips —y **la cuenta de cada chip ya mira el sector elegido**, porque un chip que
dijera «Sin sector (35)» con tres renglones abajo es peor que no tener número—.
Al lado está **«Elegir los N que se ven»**, que es lo que convierte el filtro en
una forma de juntar: se filtra por sector, se eligen todos, se juntan. Los
renglones que ya son OT no entran en esa selección.

**Y uno por equipo, que parece la gemela y no lo es** (03/11/2026). Lista sólo
los equipos que esa carga tiene —no los 269 del catálogo—, se combina con el de
sector y con los chips, y su razón de ser es la opción «— sin equipo —», que
contesta de un vistazo cuántas líneas quedaron sin máquina. La diferencia que
hay que tener presente: **sin sector un renglón no genera, y sin equipo genera
igual** —`enOrdenes` no pide el equipo—. O sea que «sin equipo» no es una cola
de trabajo pendiente sino una pregunta: esas horas no van a sumar al costo ni al
MTBF de ninguna máquina. La pantalla lo dice cuando se elige ese filtro, para
que nadie lo lea como algo que hay que completar antes de generar.

Y la trampa que no se ve desde el filtro: **un grupo sólo conserva el equipo si
todos sus renglones apuntan al mismo**. Juntar uno con equipo y uno sin deja la
OT sin equipo —quedarse con el único que hay le daría al MTBF de esa máquina las
horas de las otras tareas—, así que filtrar por equipo y juntar lo que queda a
la vista no garantiza que la orden salga con él.

#### Generar una sola OT sin juntar nada (03/11/2026)

El botón de abajo genera **todo lo que puede salir**, y con el Excel eso no era
lo que hacía falta. Medido sobre la carga real de octubre: de los 63 renglones,
**46 ya salían como su propia OT y ninguno estaba juntado**; los otros 17 esperan
el sector. O sea que el único botón ofrecía escribir 46 órdenes de una, contra
un mes que ya tiene 91 OT de PIPARO cargadas a mano.

La pregunta que llegó fue «no tengo la opción de generar una OT sin juntar», y
revela el malentendido que había que cerrar: **juntar no es el camino para
generar una sola**. Juntar es para cuando dos renglones son la misma tarea;
usarlo como el botón de «generá éste» mete horas de tareas distintas en una
orden, que es exactamente lo que el módulo evita.

Así que la generación acepta `claves` —la `clave` de cada orden: el `grupo_id`,
o `solo:<id>` si es un renglón suelto— y la barra de la selección tiene su
propio botón. Tres cosas que no se deducen del código:

- **El filtro cae sobre los grupos, no sobre los renglones.** `enOrdenes` corre
  con la carga entera y recién después se eligen las claves. Elegir un renglón
  juntado saca **su grupo entero**, con los compañeros que no se eligieron, y el
  cartel los cuenta antes de escribir: una orden con la mitad de las horas de su
  grupo sería peor que no tener el botón.
- **El tope de 25 y el freno de duplicados se cuentan después del filtro**, o sea
  sobre lo que de verdad se va a escribir. Generar de a uno pasa por el mismo
  freno que generar de a 46.
- **La comparación pantalla-contra-servidor sigue en pie.** Las dos puntas
  filtran con la misma lista de claves, así que lo que compara es lo mismo
  contra lo mismo. Si no coincide, no se genera.

Y lo que la pantalla dice de más: cuántos de los elegidos **no salen todavía**
(sin sector, sin fecha, o sin horas ni precio). Un botón que dijera «Generar 3»
con 8 elegidos y no explicara los 5 restantes es la clase de número que nadie
vuelve a creer.

#### Sacar un renglón de la carga (03/11/2026)

La otra mitad del mismo pedido: «que pueda borrar una línea, porque alguna de
esas capaz ya tiene OT creada». Es el caso real de octubre —la planilla trae
tareas cuya orden ya está escrita a mano— y hasta ahora no había qué hacer con
ellas: dejarlas sin generar deja la carga eternamente en `EN_CHEQUEO` con
renglones que nadie sabe por qué no salieron.

Vive en `app/api/mantenimiento/cuaderno/renglones/[id]` y **no en el `DELETE` de
`/renglones`**, que saca el `grupo_id` y deja el renglón vivo. Son dos cosas
distintas: un `DELETE` que según el cuerpo desagrupa o destruye es la clase de
ambigüedad que se paga una sola vez y cara.

Lo que no se deduce del código:

- **No se saca el que ya es una orden de trabajo del sistema**, ni el que está
  en un grupo que ya generó. Lo segundo lo decide `sePuedeSeparar`, la misma
  función que usa separar y no una copia: sacarlo le cambiaría el total a una
  orden ya escrita en la planilla.
- **Se audita, con el verbo `borrar`, y es el primero que escribe una persona.**
  Hasta acá ese verbo lo escribían sólo las sincronizaciones
  (`lib/core/borradoDeEspejo.ts`). El argumento no es «borrar es grave» sino
  cuál pregunta queda sin respuesta: el archivo de origen sigue en el bucket,
  así que **qué decía** se contesta sin la tabla; **quién lo sacó y cuándo** no.
  Y estas filas son con lo que se le paga al contratista, así que una que
  desaparece es una hora que no se factura por el criterio de una persona.
  El registro se escribe **antes** del borrado —si no entra, no se borra—,
  que es el orden que fijó `borradoDeEspejo.ts`.
- **El estado de la carga se recalcula al sacar**, no sólo al generar: sacar el
  último pendiente puede dejarla `GENERADA`. Por eso `actualizarElEstado` se
  mudó de la ruta de generación a `lib/mantenimiento/cuadernoEstado.ts`: con una
  copia en cada ruta, el día que la regla cambie una de las dos la sigue
  diciendo vieja.
- **Nada cuelga de `mant_cuadernos_renglones` por clave foránea** (comprobado
  con `node scripts/que-cuelga-de.mjs`), así que borrar una fila no se lleva
  nada en cascada.

El botón va chico y abajo en el renglón, no al lado de los campos que se tocan
todo el tiempo: es lo único irreversible de esa fila.

#### La OT que queda escrita en la planilla y no entra al sistema (03/11/2026)

**Crear una OT desde el cuaderno son dos escrituras que no se pueden atar.**
Primero `altaEnLaPlanilla` toma un número y escribe la fila en «Altas del
sistema»; después la ruta inserta en `ordenes_trabajo` y marca los renglones.
Si lo segundo falla, **la orden ya está escrita en la planilla de producción**
—que se borra a mano, fila por fila— y el sistema no sabe que existe. La ruta
lo dice en la pantalla de quien generó, con esas palabras, y ahí se termina el
rastro: si esa persona cierra la página, no queda nada.

Pasó con la **OT 2983** («Pasar 1400 barras/cuadrados rompedores», fila 100).
Lo que lo volvía peligroso no era la orden perdida sino que **su renglón seguía
sin convertir**: la próxima generación habría creado una segunda OT por el
mismo trabajo. Se encontró contando los números —la corrida hizo 2972..2982,
saltó la 2983 y la siguiente arrancó en 2984— y se arregló insertando la fila
con los mismos valores que habría armado la generación y enlazando su renglón.

Ese conteo quedó como **`npx tsx scripts/ot-huerfanas-del-cuaderno.mts`**: lee
la columna A de «Altas del sistema» y la compara contra `ordenes_trabajo` en
ese rango. No escribe nada y no interpreta: lo que busca es estrecho a
propósito —**un número que la planilla tiene y la base no**—, porque una OT
sin renglón es normal (las que se cargan desde la pantalla de alta tampoco lo
tienen) y mezclar las dos cosas lo volvería ruido. Si la pestaña no devuelve
ninguna fila corta sin concluir nada, porque una planilla recalculando se lee
igual que una vacía. Sale 1 si encuentra alguna; hoy da **HUÉRFANAS 0**.

#### Octubre de 2026: el primer mes real que salió entero (03/11/2026)

El Excel de octubre se generó completo. Los números, porque son la primera
medición de este camino de punta a punta:

- **58 renglones → 48 órdenes de trabajo**, OT **2972 a 3019**, sin saltearse
  ningún número. 978 horas. Las 48 nacen `REALIZADO`, con horas y con fecha de
  cierre. La carga quedó en `GENERADA`.
- Las 63 filas originales fueron **58** porque se sacaron 5 renglones cuya OT ya
  estaba cargada a mano (queda en `auditoria`, con quién y qué decía).
- El **freno de duplicados saltó con 91** —las OT de PIPARO de octubre cargadas
  por otro camino— y hubo que confirmarlo. Se cruzaron las 17 últimas contra
  esas 91 antes de confirmar: **ninguna pisaba una real**. Las 5 que compartían
  palabras («Rep paño zaranda», «Cambiar lateral cinta 5», «Limpieza techo 02»)
  eran todas del **02/10**, con otras horas y otro equipo. El freno hace lo que
  tiene que hacer —avisar— y la decisión sigue siendo de quien mira.
- **47 de las 48 quedaron con `sheets_pendiente`** y eso es lo normal, no un
  fallo: el master recibe la fila por `IMPORTRANGE` y tarda, así que el estado,
  las horas y el cierre viajan en la cola. Mientras estén ahí,
  `sincronizar.ts` **no las pisa** —es para eso que existe la marca— y
  `exportarLoPendiente` las termina en el sync siguiente. Hasta entonces, esas
  columnas del master se ven vacías y no hay nada perdido.

**Lo que quedó sin explicar, y lo que hay que capturar la próxima vez.** No
salió de una sola apretada: fueron **cuatro corridas de 12, 19, 8 y 9**, y
ninguna se topó con un límite conocido —el tope son 25, el margen de tiempo son
200 s y las corridas duraron 18, 29, 13 y 32 segundos, a 1,6 s por orden—. Se
descartaron, midiendo contra los datos y la planilla reales: la validez de los
renglones, la serie de números, el encabezado de altas, el armado de las
celdas, el `INSERT` en `ordenes_trabajo` (probado con las 18, con números de
descarte), el tamaño de la grilla (999 filas, vamos por la 119), la salud de
las planillas y el permiso de escritura de la cuenta de servicio. **Queda la
hipótesis de que quien genera eligió ir de a poco** —el botón de la selección
y el filtro por sector hacen exactamente eso—, y no hay forma de distinguirlo
en los datos. Si vuelve a pasar, **lo único que falta es el texto que muestra
la pantalla**: la ruta deja cada fallo en `problemas`, sin traducir, y con esa
línea se sabe dónde está. Sin ella no se puede arreglar sin adivinar, y lo que
falla escribe en la planilla de producción.

#### La descripción dice sólo qué se hizo, y lo demás va en su columna (03/11/2026)

Al mirar las 48 órdenes recién generadas, lo que estaba mal era esto:

    H (DESCRIPCIÓN): Resoldar chapas impacto rompedores p/ TRT Nº2 — PIPARO.
                      El 19/10. 8 h en total. Según el cuaderno: Resoldar
                      chapas impacto rompedores p/ TRT Nº2 (19/10, 8 h).
    K (FECHA DE CIERRE): —    M (ESTADO): —    N (CONTRATISTA): —    O (HORAS): —

Cuatro datos apilados en una celda de prosa **que tienen su propia columna**, y
las cuatro columnas vacías. Desde un párrafo no se filtra ni se suma, y la
planilla es de donde lee quien no entra al sistema.

Son dos problemas distintos con el mismo síntoma, y conviene no confundirlos.

**Uno: el texto.** `descripcionDeLaOrden` ahora devuelve sólo la tarea. Lo que
pierde, dicho: el detalle renglón por renglón —qué día y cuántas horas cada
uno— deja de estar en la planilla. No se pierde del sistema —vive en
`mant_cuadernos_renglones`, enlazado a esa misma OT, y se ve en la pantalla del
cuaderno—, pero quien mira sólo la planilla ve el total y no el reparto.

**El denominador común de un grupo** vive en
[lib/mantenimiento/cuadernoDescripcion.ts](../lib/mantenimiento/cuadernoDescripcion.ts),
y lo que no se deduce del código es por qué no alcanzaba con «si son todas
iguales, usar ésa»: medido sobre los **cinco grupos que una persona juntó de
verdad, ninguno tiene las tareas idénticas**.

| Las tareas del grupo | Queda |
|---|---|
| «Limpieza techo Hidratación» · «Limpieza techo hidratacion» · «Limpieza techos hidratacion» · «Limpieza techos hidratación» | **Limpieza techo Hidratación** |
| «Limpieza p/ TRT Nº2» · «Limpieza y destorar pantalón en planta TRT Nº2» · «Limpieza espaldas tolvas p/ TRT Nº2 a pastareras y parte inferior» | **Limpieza TRT Nº2** |
| «Limpieza p/ TRT Nº1» · «Limpieza túnel y pozo p/ TRT Nº1» | **Limpieza p/ TRT Nº1** |
| «Pasillo en cinta 1 superior» · «Pasillo cinta 1» | **Pasillo cinta 1** |
| «Limpieza en cinta tolva» · «Limpieza cola cinta 1 filer 2 parte superior» · «Limpieza en cinta 2 filer p/ sup.» · «Limpieza costado tolva filer 2» | las cuatro, con `·` |

Tres cosas que no se deducen del código:

- **El plural cuenta como la misma palabra** (`mismaPalabra`). Sin eso, «techo»
  y «techos» no coinciden y el primer grupo se queda en «Limpieza Hidratación».
  El límite es prefijo exacto, las dos de cuatro letras o más y a lo sumo dos
  de diferencia: por eso **«Nº1» y «Nº2» no se parecen nunca**, que es lo que no
  puede fallar —una OT de la TRT Nº1 en la Nº2 no se nota—.
- **Con menos de dos palabras en común no se inventa un resumen**: se listan las
  tareas distintas. Es el último caso, donde lo único compartido es «limpieza»,
  y una orden que dijera sólo eso sería peor que no simplificar.
- El texto sale **con las palabras de la primera tarea**, con sus acentos y sus
  mayúsculas: es como lo escribió quien llevó el cuaderno.

**Dos: las columnas, que es el problema de verdad.** De la K en adelante son
literales del master, y para escribirlas la fila tiene que existir ahí —llega
por `IMPORTRANGE` y tarda—. La generación lo intentaba **a medio segundo de
crear la orden**, o sea nunca a tiempo, anotaba `sheets_pendiente` y ahí
quedaba: lo terminaba quien abriera Órdenes o la sincronización, en la
práctica cada 3 a 5 horas.

Lo que lo cierra es que **el mecanismo ya existía y esta ruta era la única que
no lo usaba**. Medido el 03/11/2026, el mismo día:

| | |
|---|---|
| OT del cuaderno | **48 de 48 con K/M/N/O vacías**, 47 en la cola |
| OT de `/api/mantenimiento/ordenes` (que sí reintenta) | **12 de 12 salieron, todas en el primer intento, a los 21 s** |

Así que la generación drena su propia cola con `after()`, y lo que hay que
saber antes de tocarlo:

- **Una pasada para toda la corrida, no una por orden.** El master recibe las 25
  juntas; esperar una vez y drenar la cola entera son 25 lecturas de la columna
  A en vez de 25 esperas de 20 segundos.
- Usa `exportarLoPendiente` **sin freno** —la misma función de la pantalla de
  Órdenes y del sync—, así que drena todo lo que haya en la cola y no sólo lo
  de esta corrida. Es lo correcto: lo viejo también hay que terminarlo.
- **El `after()` corre dentro del mismo `maxDuration`**, así que las esperas se
  recortan a lo que queda (`esperasQueEntran`). Pasarse no rompe nada —la cola
  sigue siendo la red—, pero arrancar una espera de dos minutos cuando quedan
  treinta segundos es desperdiciar el intento.

**El costo no cambió**: sigue viajando en `REPUESTO UTILIZADO`, que es donde la
práctica ya lo escribía a mano (58 de las 380 OT viejas de PIPARO). Con repuesto
y precio queda `2 parches de 200 ($240.000)`; con precio solo, `$920.000`.

**Las 48 de octubre se corrigieron a mano el 03/11/2026**, a pedido, con
[scripts/corregir-ot-del-cuaderno.mts](../scripts/corregir-ot-del-cuaderno.mts)
—que sin `--escribir` no toca nada—. Quedó: 48 descripciones acortadas en
«Altas del sistema» y en la base, 0 con el texto viejo de los dos lados, 0 en la
cola, y **47 de 48 con K/M/N/O en el master**.

Tres cosas de esa corrida que vale la pena saber:

- **La salvaguarda fue reconstruir el texto viejo** desde los renglones de cada
  orden y exigir que coincidiera **exacto** con lo que la base tenía guardado.
  Las 48 coincidieron, o sea que nadie las había editado; la que no hubiera
  coincidido se salteaba, porque corregir lo que escribió una persona es peor
  que dejar el texto largo.
- **Primero la planilla y después la base.** Si la planilla sale y la base no,
  la próxima sincronización las empareja; al revés, la planilla pisaría la base.
- **La que faltaba era la 2983**, y se cargó a mano después (ver abajo).

**Y una medida que va a volver: el drenaje pega contra la cuota de Google.**
`exportarLoPendiente` lee la columna A del master **una vez por orden en la
cola**; con 48 encoladas de golpe, una se cayó con

    Google respondió 429: Quota exceeded for quota metric 'Read requests' and
    limit 'Read requests per minute per user'

y quedó en la cola hasta la pasada siguiente, que es exactamente lo que la cola
existe para que pase. No se tocó nada por ahora —el reintento lo resuelve—,
pero con un mes de 100 órdenes esto va a dejar varias para la segunda vuelta: el
día que moleste, lo que hay que cambiar es que el drenaje lea la columna A **una
vez por pasada** y no una por orden.

#### La OT 2983, cargada a mano (03/11/2026)

Era la única de las 48 sin K/M/N/O, y la hipótesis que teníamos era falsa: **sí
estaba en `ordenes_trabajo`**. Lo que le había pasado es otra cosa, y es la que
conviene recordar.

La generación le escribió el alta en la planilla a las **14:08:21** y algo se
cortó antes de guardar el resto. La fila quedó en «Altas del sistema» y en el
master, y la **sincronización de las 14:44 la trajo a la base** —con lo único
que la planilla tenía: descripción, sector, equipo y prioridad—. Por eso no
estaba en la cola: `sheets_pendiente` nunca se le puso, así que el drenaje que
terminó a las otras 47 ni la miraba.

Comparada con sus hermanas le faltaban exactamente cuatro campos, y los cuatro
salían de su propio renglón —línea 11, «Pasar 1400 barras/cuadrados rompedores»,
del 07/10 al 21/10, 28 h—:

| | tenía | quedó |
|---|---|---|
| `fecha_cierre` | null | 2026-10-21 |
| `estado` | `POR_HACER` | `REALIZADO` |
| `contratista` | null | PIPARO |
| `horas` | null | 28 |

Lo hizo
[scripts/cargar-a-mano-la-ot-2983.mts](../scripts/cargar-a-mano-la-ot-2983.mts),
que antes de escribir **comprueba que no haya otra orden con la misma
descripción**: completar una que ya estuviera cubierta por otra sería darle dos
órdenes al mismo trabajo, y a PIPARO se le paga por esto.

Dos cosas que no se deducen del código:

- **`fecha` no se tocó, y dice 2026-11-03.** No es un error de esta orden: **las
  48 dicen lo mismo**, porque la sincronización la trae de la marca temporal
  (columna B del master, derrame de la hoja de respuestas). Corregirla sólo en
  ésta la habría dejado distinta de sus hermanas y la próxima corrida la pisaba
  igual. La fecha del trabajo vive en `fecha_cierre` y en `fecha_ejecucion`.
- **La columna L dice «Atrasado» en las 48, y está bien así.** Es la
  `ARRAYFORMULA` del master, que compara la fecha de inicio con hoy y no mira el
  estado: medido, **56 OT viejas de PIPARO ya «Realizado» dicen lo mismo**. No
  lo causó esta carga y no hay nada que arreglar ahí.

Después de esto, de las 48: **0 incompletas en la base, 0 en la cola, 0 con el
texto viejo, y 48 de 48 con K, M, N y O en el master.**

### Lo que quedó anotado

- **`npm run catalogo` se dejó sin correr a propósito, para cuando el árbol esté
  tranquilo.** Hoy el Asistente no conoce `ordenes_trabajo.costo`,
  `proveedores.modo_de_carga` ni las tres tablas nuevas. Regenerarlo arrastra de
  una vez lo de las otras sesiones (nueve tablas nuevas y columnas nuevas en
  `avisos`, `francos`, `mantenimientos_programados` y `ordenes_servicio`), y las
  15 tablas sin mapear en `lib/asistente/modulos.ts` piden decidir cada una:
  mapearla o ponerla en `SIN_MAPEAR_A_PROPOSITO`. Las del cuaderno son de
  `mantenimiento`.
- **Pendientes del plan**: qué hacer con una línea tachada, y avisar cuando un
  día sale fuera de orden. (El tope a las horas de un renglón ya está: ver más
  arriba.)

## Los datos: qué está y qué no

**Todo lo que viene de las planillas está.** Avisos 138, órdenes de trabajo
1.728, órdenes de servicio 220, cotizaciones 147, equipos 239, componentes 398,
tipos 26, sectores de planta 15 —hoy 13, ver "Despacho filler deja de ser un sector".

**Lo que vivía sólo en la base de la app vieja no se migró**, porque no viaja
por las planillas: los checklists de equipos, los mantenimientos programados,
las ejecuciones ya registradas con sus fotos, el plan de producción cargado, los
repuestos por OT, el orden manual y las marcas de "requiere parar el sector".

**No está verificado, y no es lo mismo que estar vacío.** La app vieja usa otra
base de Supabase y de ella sólo tenemos la clave pública, que con RLS no
devuelve nada. Para saber qué hay ahí hace falta su `service_role`.

## Lo que quedó anotado para decidir después

**Resuelto: los contratistas son proveedores.** Ver `## Un solo lugar para los
proveedores`.

**Al portar, revisar `UNFORMATTED_VALUE`.** La app de origen arregló un bug de
fechas en null leyendo Sheets sin formatear. Este ERP tiene su propio lector en
`lib/compras/sheets.ts` y ya se le corrigieron dos cosas parecidas —el día y el
mes dados vuelta, y las celdas ilegibles pisando estados—; conviene mirar los
dos lados antes de portar el de mantenimiento.

---

## El `datetime-local` de Ejecuciones guardaba tres horas antes (13/10/2026)

El formulario de `/mantenimiento/ejecuciones` es **el único `datetime-local` del
sistema**, y tenía dos problemas encadenados que se tapaban entre sí.

**Lo que se mostraba.** El campo se prellenaba con
`new Date().toISOString().slice(0, 16)`, o sea la hora **UTC**: a las 14:30 de
acá ofrecía las 17:30. Tres horas adelantada siempre, no sólo de noche.

**Lo que se guardaba.** El texto del campo viaja sin huso, y `executed_at` es
`timestamptz`: Postgres lo lee como UTC. Una hora tipeada como 14:30 quedaba
guardada como 11:30 de Argentina.

**Por qué nadie lo notó.** Los dos errores se cancelan **cuando la persona
acepta el valor por defecto**: el campo ofrece la hora UTC, se guarda como UTC,
y el instante termina siendo el correcto. El daño aparece sólo cuando alguien
**tipea** una hora — y las listas muestran `toLocaleDateString`, o sea sólo el
día, así que un corrimiento de tres horas sólo se ve si cruza la medianoche.

### Lo que había que arreglar en los datos, y por qué fueron dos filas

La tabla tenía **dos ejecuciones en total**, las dos con la hora tipeada:

| | Antes | Después |
|---|---|---|
| `executed_at` crudo | `2026-08-31T00:00:00+00:00` | `2026-08-31T03:00:00+00:00` |
| La lista mostraba | **30/8/2026** | **31/8/2026** |

Las dos tenían el instante exactamente en medianoche UTC, que es lo que queda
cuando alguien **elige la fecha en el selector y no toca la hora**. Las dos se
habían cargado la mañana del 31/8 (`created_at` 11:20 y 11:39). Eligieron el
31 y la lista decía 30: se les sumaron tres horas y quedó el día que
corresponde.

**El testigo que permite distinguir una fila sana de una corrida es
`created_at`**, que el formulario nunca escribe. Si `executed_at` está a menos
de dos minutos de `created_at`, la persona aceptó el valor por defecto y el
instante es correcto. Si difiere, tipeó algo — y eso es lo que estaba corrido.
Con esa regla, de las dos filas las dos eran candidatas y ninguna estaba sana.

### Si hay que deshacerlo

```sql
update mantenimientos_ejecuciones
   set executed_at = executed_at - interval '3 hours'
 where executed_at = '2026-08-31T03:00:00+00:00';
```

### Lo que impide que vuelva

`lib/core/fechas.ts` tiene ahora `ahoraEnArgentina()` —para prellenar un
`datetime-local`— e `instanteDeArgentina()` —para mandarlo con huso `-03:00`—,
las dos con tests. Y `eslint.config.mjs` tiene una regla que rechaza
`new Date().toISOString().slice(0, 16)`, que es la forma exacta que causó esto.
