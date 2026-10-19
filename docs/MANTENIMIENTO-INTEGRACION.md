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
H descripción · I repuesto · J ejecución · K cierre · L (calculada) · M estado ·
N contratista · O horas · P/Q/R operarios · S prioridad · T frecuencia ·
U próxima fecha · V fotos · W observaciones · X observación previa`

La **X se agregó el 16/10/2026** y es la única que no estaba en el origen. Ver
"Por qué una OT todavía no se hizo", más abajo.

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
celda va el texto de todos juntos, separados por coma: `2 grillas 2 mm, 4
martillos`. La coma no es decorativa — es por donde corta `itemsDeRepuesto()` de
[lib/mantenimiento/repuestosDesdeOt.ts](../lib/mantenimiento/repuestosDesdeOt.ts),
el parseo que sacó los repuestos de las 275 OT viejas, así que lo que el
sistema escribe hoy se vuelve a leer igual que lo que escribió la gente a mano.
Hay tests que hacen la vuelta completa en
[repuestosDeLaOT.test.ts](../lib/mantenimiento/repuestosDeLaOT.test.ts).

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

**"Despacho cal" está en el catálogo y no en el formulario, a propósito.** Tiene
7 equipos y 39 órdenes, que llegaron por el código del equipo y no por el
nombre. La lista del formulario dice *quién solicita* y el catálogo dice *dónde
está la máquina*: no son la misma taxonomía, y sacarlo de los de planta lo
borraría de los filtros dejando esas 39 sin poder filtrarse.

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
primero, después lo urgente, después lo que espera hace más— y el **manual** sale
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
