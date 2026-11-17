# Seguridad e Higiene — condiciones inseguras

**Fecha:** 29/10/2026
**Estado:** diseño acordado, sin empezar

---

## Por qué

Hoy las condiciones inseguras de la planta viven en un `.xlsm` que circula por
mail. Lo abrí y medí lo que tiene, porque el estado real de esa planilla es la
mitad del argumento:

- **44 condiciones cargadas** (filas 10 a 53 de la hoja `CI Operativas`), todas
  detectadas entre el 01/10/2026 y el 13/10/2026 por una sola persona.
- **35 de esas 44 no tienen la evaluación de riesgo cargada.** Sólo 9 llegaron
  a tener los cinco puntajes. La columna que debería ordenar el trabajo está
  vacía en el 80% de los casos.
- **52 fotos, y ninguna está en el archivo.** Son hipervínculos a
  `C:\Users\…\AppData\Roaming\Microsoft\Excel\Fotos\`: viven en el disco de la
  computadora donde se armó la planilla. Quien recibe el libro por mail ve el
  link y no puede abrir nada.
- **La fórmula de clasificación está rota.** En todas las filas menos la 10
  dice `IF(151>=49,"M",…)`: una constante donde iba `U>=49`. Como `151>=49` es
  siempre verdadero, **nada puede clasificar PS ni NS** — todo lo que quede por
  debajo de 90 sale "M". Nadie lo notó.
- **El bloque de programación (columnas AP a BD) no funciona.** Busca fechas en
  dos hojas ocultas, `Fijos` y `Moviles`, que son de **otra empresa**:
  "Condiciones inseguras – Hormigones Avellaneda", con plantas Laferrere,
  Pompeya y Pacheco y datos de 2013 a 2017. El libro es una copia de una
  planilla ajena a la que se le cambió la hoja de adelante. Los `VLOOKUP`
  cruzan **por el texto de la acción propuesta** y devuelven vacío; una de las
  columnas es directamente `#REF!`.
- **"Equipo o sector" es texto libre** y ya duplica: `Planta 2` y `Planta 02`
  conviven como si fueran dos lugares distintos.
- **"Motivo o herramienta de detección" tiene un nombre de persona** en las 44
  filas. La columna se está usando como "quién lo vio", que no es lo que su
  encabezado dice.

Ninguno de esos seis problemas es de la gente que carga: son de la herramienta.
Los seis se caen solos cuando esto pasa a tablas, pantallas y permisos.

El SdG ya tiene todo lo que esto necesita y no tiene: un catálogo de sectores y
equipos compartido, fotos en Storage, permisos por módulo, una pantalla que
carga sin señal y un resumen diario que avisa.

---

## Qué se construye

Un **décimo módulo**, `Seguridad e Higiene`, que por ahora contiene una sola
cosa: **condiciones inseguras**. Tiene dos caras y se cargan en dos tiempos.

### 1. La carga, desde el teléfono

Un formulario corto, para completar parado en la planta, al lado de lo que se
está mirando. Seis campos:

| Campo | Cómo se llena |
|---|---|
| Foto | la cámara del teléfono; **una o varias** |
| Sector o equipo | del catálogo del núcleo, no texto libre |
| Qué viste | texto |
| Peligro | del glosario de 32 que ya tiene la planilla |
| Acción propuesta | texto |
| Prioridad | 1, 2 o 3 |

**No se pide la evaluación de riesgo ni el responsable.** La condición nace
marcada como *sin evaluar* y *sin asignar*, y eso se ve en la pantalla de
gestión. Fue una decisión explícita contra la alternativa de pedir los 17
campos de la planilla en el teléfono: hoy, con los 17 pedidos, 35 de 44 quedan
sin evaluar igual. Mejor que falte y se vea, a que falte y se pierda.

### 2. La gestión, desde la computadora

La tabla. Filtra, ordena, y pone primero lo que le falta algo. Desde ahí se
completa lo que el teléfono no pidió:

- los cinco puntajes de riesgo, y con eso el nivel y la clasificación;
- responsable y fecha máxima de ejecución;
- si requiere inversión, y las observaciones;
- la fecha de ejecución, que es la que cierra.

Y se ven las fotos, se bajan y se comparten.

---

## Las decisiones que se tomaron, como se tomaron

Estas las decidió el usuario en la charla del 29/10/2026. No son derivables del
código ni del Excel.

1. **La carga va en dos tiempos.** El teléfono pide seis campos; el riesgo y la
   asignación se completan después desde la computadora, y lo que falta se
   muestra como pendiente en vez de quedar en blanco.

2. **Seguridad e Higiene lleva sus propias acciones. No crea órdenes de
   trabajo.** Cuando una condición merece una OT, Mantenimiento la crea a mano,
   como cualquier otra. **Sin enlace automático y sin cruzar por texto** — que
   es exactamente lo que el Excel intenta y lo que le devuelve `#REF!`.

3. **Sólo quien tenga acceso al módulo puede cargar.** Se consideró abrirlo a
   cualquier usuario activo, como ya pasa con la foto de un aviso de
   Mantenimiento y con el alta de un requerimiento de Compras, y se decidió que
   no: por ahora, queda detrás del permiso. ("Por ahora" es del usuario: es una
   puerta que se puede abrir después sin romper nada.)

4. **Las fotos van a la base**, se ven fácil, se bajan y se comparten; y además
   **tienen una copia de respaldo en Drive**.

5. **El formulario del teléfono entra en `/cargar` como tercer tipo de carga**,
   junto al aviso y la OT, para que ande sin señal.

6. **Por ahora sólo condiciones inseguras, pero dejándole lugar** a lo que
   venga después (accidentes, capacitaciones, entrega de EPP, inspecciones).

---

## Objetivos

- Que cargar una condición desde la planta lleve menos de un minuto y no
  dependa de tener señal.
- Que la foto quede guardada en un lugar que no sea el disco de una persona, y
  que se pueda abrir, bajar y compartir desde el sistema.
- Que lo que falta —el riesgo sin evaluar, el responsable sin asignar, la fecha
  vencida— sea lo primero que se vea, y no algo que haya que ir a buscar.
- Que el sector y el equipo sean los mismos que usa el resto del SdG, así una
  condición de "Planta 2" y una OT de "Planta 2" hablan del mismo lugar.
- Que el módulo pueda crecer sin rehacerse.

## No objetivos

- **No crea ni toca órdenes de trabajo, avisos ni nada de Mantenimiento.**
  (Decisión 2.)
- **No tiene planilla de Google.** El SdG es el único lugar donde esto vive, como
  pasa con Ensayos de Calidad. No hay `sheets_fila` ni `sheets_pendiente`, no
  hay sincronización y no hay nada que espejar. Es una decisión mía y la explico
  abajo.
- **No hace la re-evaluación de riesgo residual.** La hoja de criterios del
  Excel define una segunda tabla ("RE EVALUACIÓN DE RIESGO RESIDUAL", con la
  escala de controles invertida: 1/3/5 en vez de 5/3/1) pero **la planilla no
  tiene ninguna columna donde ponerla**. Está definida y sin usar. Queda afuera
  hasta que alguien la pida; el modelo no la impide.
- **No reemplaza el legajo de seguridad ni nada que tenga valor legal.** Es la
  libreta de lo que hay que arreglar.
- **No migra las hojas `Fijos` y `Moviles`.** Son de otra empresa.

## Anti-objetivos

Cosas que harían fracasar esto aunque funcione:

- **Que la evaluación de riesgo vuelva a ser opcional en silencio.** Si el 80%
  queda sin evaluar y la pantalla no lo grita, construimos el Excel otra vez
  con otra tipografía.
- **Que la foto dependa de tener señal.** Es el único campo que no se puede
  recuperar después: el cardán sin protección se protege y la foto ya no se
  puede sacar.
- **Que esto se convierta en una segunda lista de tareas de Mantenimiento.** La
  decisión 2 lo evita a propósito. Si en seis meses alguien está copiando a mano
  cada acción a una OT, el diseño falló y hay que volver a discutirlo — pero se
  discute, no se parchea con un cruce por texto.
- **Que un aviso mal calibrado termine en que alguien apague las
  notificaciones.** Vale la regla que ya está escrita en `CLAUDE.md`.

---

## El modelo

### Nombres

- Valor del enum `modulo`: **`seguridad_higiene`**
- Ruta: **`/seguridad-higiene`** · carga offline en **`/cargar`**
- Carpeta de código: `app/(app)/seguridad-higiene`, `lib/seguridadHigiene`,
  `app/api/seguridad-higiene`
- Prefijo de tablas: **`syh_`**

El prefijo corto es decisión mía: `seguridad_higiene_condiciones_fotos` es
impracticable, y `syh` es como el usuario llamó al módulo.

### Tablas

**`syh_condiciones`** — una fila por condición insegura.

Lo que carga el teléfono:

| Columna | Notas |
|---|---|
| `id` | |
| `numero` | correlativo visible, como el `N°` de la planilla |
| `sector_id` / `equipo_id` | **al catálogo del núcleo.** Como mucho uno de los dos |
| `detectada_el` | fecha |
| `detectada_por` | → `usuarios`. Es quien carga, no un texto |
| `descripcion` | |
| `peligro_id` | → `syh_peligros` |
| `accion_propuesta` | |
| `prioridad` | 1, 2 o 3 |

Lo que se completa después, desde la gestión — **todo nullable**, porque la
condición nace sin esto y eso es el diseño, no un hueco:

| Columna | Notas |
|---|---|
| `responsable_id` | → `usuarios` |
| `fecha_maxima` | |
| `fecha_ejecucion` | la que cierra |
| `requiere_inversion` | booleano nullable: null es "todavía no se decidió" |
| `observaciones` | |
| `frecuencia`, `antecedentes`, `controles` | los tres de probabilidad |
| `magnitud_dano`, `legislacion` | los dos de gravedad |

Y lo calculado, que no se escribe a mano nunca:

| Columna | Cómo |
|---|---|
| `probabilidad` | generada: `frecuencia + antecedentes + controles` |
| `gravedad` | generada: `magnitud_dano + legislacion` |
| `nivel_riesgo` | generada: `probabilidad * gravedad` |

**`syh_peligros`** — el glosario. 32 filas, con nombre y descripción, tal como
están en la hoja `Glosario Peligros`. Es un catálogo con `activo`, no una lista
en el código: la planilla ya tiene uno ("Torceduras" sin descripción) y van a
querer agregar.

El `check` de la base es **`num_nonnulls(sector_id, equipo_id) <= 1`**, no
`= 1`. Si fuera `= 1` la migración de las 44 sería imposible: las que no se
reconocen con certeza entran sin lugar, a propósito. **Que el lugar sea
obligatorio es regla del alta desde el teléfono, no de la tabla** — parado
frente al problema siempre se sabe dónde se está.

**`syh_fotos`** — una fila por foto, con `condicion_id`, `ruta` en el bucket,
quién la subió y cuándo, y `respaldada_en_drive_el` (null hasta que el respaldo
corra). Es una tabla aparte y no un array de links en la condición porque la
planilla ya tiene filas con dos fotos y una con más, y porque el respaldo
necesita saber, por foto, si ya viajó.

### El estado no es una columna

En el Excel el estado es una fórmula. Acá es **derivado, no guardado**:

- hay `fecha_ejecucion` → **Cerrada**
- no hay, y `fecha_maxima` ya pasó → **Vencida**
- en cualquier otro caso → **Pendiente**

Guardarlo sería tener dos verdades: una fila "Pendiente" con la fecha máxima en
el mes pasado. Va en `lib/seguridadHigiene/` como función pura, con tests, igual
que el resto de la lógica que importa en este repo.

Para el que gestiona hay dos estados más que **no son el estado de la
condición** sino lo que le falta: **sin evaluar** (alguno de los cinco puntajes
en null) y **sin asignar** (sin responsable o sin fecha máxima). Se cruzan con
el estado: una condición puede estar Pendiente y sin evaluar a la vez.

### Los umbrales del riesgo

Probabilidad = frecuencia + antecedentes + controles. Gravedad = magnitud del
daño + legislación. Nivel = probabilidad × gravedad. Y de ahí:

| Nivel | Clasificación |
|---|---|
| ≥ 139 | **I** — Intolerable |
| ≥ 90 | **S** — Significativo |
| ≥ 49 | **M** — Moderado |
| ≥ 18 | **PS** — Poco significativo |
| > 0 | **NS** — No significativo |

**Estos son los umbrales buenos, y hay que decir de dónde salen.** La fórmula
del Excel está rota en todas las filas menos la 10: dice `IF(151>=49,"M",…)` en
vez de `IF(U>=49,"M",…)`. Los cinco umbrales de arriba son los de esa fila 10,
que es la única que quedó sana. Los 8 "PS" que aparecen en la columna son
valores viejos cacheados en filas que ya no tienen datos.

Los puntajes posibles de cada criterio salen de la hoja `Criterios de
aplicación` y son fijos: frecuencia 3/2/1, antecedentes 3/2/1, controles 5/3/1,
magnitud del daño 9/7/3, legislación 5/3/1. **No son un número libre: son un
desplegable con su texto.** El texto de cada opción —el párrafo largo que
explica cuándo corresponde— va en el desplegable o al lado, porque es lo que
hace que dos personas puntúen parecido. **Están transcriptos completos al final
de este documento**, para no depender del `.xlsm`.

### Lo que le falta a una condición son tres cosas, no dos

Cruzadas con el estado (Pendiente / Cerrada / Vencida), y las tres se ven en la
gestión:

- **sin evaluar** — alguno de los cinco puntajes en null;
- **sin asignar** — sin responsable o sin fecha máxima;
- **sin lugar** — ni sector ni equipo. No pasa cuando se carga desde el
  teléfono, donde el lugar es obligatorio; pasa en las 44 que se migran, porque
  algunos textos del Excel (`Cal`, `Deposito abierto`) puede que no sean nada
  del catálogo y la regla es dejarlos en null antes que enlazar al que se le
  parece.

### Lo que queda preparado y vacío

El módulo tiene que poder recibir accidentes, capacitaciones, EPP e
inspecciones sin rehacerse. Concretamente eso significa:

- La raíz `/seguridad-higiene` es un **tablero con tarjetas**, como `/calidad`,
  y hoy tiene una sola: Condiciones inseguras. Agregar la segunda es agregar
  una tarjeta y una ruta, no mudar la primera.
- Las tablas llevan el prefijo `syh_` y no `condiciones_`.
- El permiso es del módulo entero, no de las condiciones.

Lo que **no** hay que hacer es abstraer de más ahora. Una sola cosa no define
una familia; cuando llegue la segunda se va a ver qué comparten de verdad.

---

## Las fotos

Van a **Supabase Storage**, como las de Mantenimiento. El bucket es nuevo
(`syh-fotos`) y no se reusa `execution-photos`, porque ése es de Mantenimiento
y tiene sus propias reglas y su propia lista de tipos.

Hay una ruta que hace casi exactamente esto y conviene mirarla antes de escribir
la nueva: `app/api/mantenimiento/fotos/route.ts`. Lo que ya aprendió, y que no
hay que volver a aprender:

- **Los tipos aceptados tienen que coincidir con `allowed_mime_types` del
  bucket.** Cuando no coincidieron, una foto HEIF pasaba el chequeo de la ruta y
  la rechazaba Storage con un 502 que no explicaba nada.
- **Lo que llega del formulario termina en una ruta del bucket**, así que se
  limpia: un archivo llamado `a./../x` daría extensión `/x`.
- **El link sirve para siempre sólo si el bucket es público**; si no, se firma
  uno y se avisa.

Acá **el bucket va privado**. En Mantenimiento tenía que ser público porque el
link se escribe en una planilla que mira gente sin sesión; este módulo no tiene
planilla y no hay nadie sin sesión que deba ver una foto de una condición
insegura. Los links se firman al pedirlos. (Decisión mía.)

**El respaldo en Drive.** Reusa la cuenta de servicio que ya usan Compras,
Mantenimiento y el backup de la base — no hay credenciales nuevas. Corre como
cron, sube las fotos que todavía no tienen `respaldada_en_drive_el` y marca la
fecha. Lo que hay que saber antes de escribirlo, y que está explicado en
`scripts/backup/subir-a-drive.mts`: **la carpeta tiene que estar en una unidad
compartida.** Una cuenta de servicio no tiene cuota de Drive; subir a "Mi
unidad" de alguien falla con *"Service Accounts do not have storage quota"*
aunque la carpeta esté compartida como editor.

Hace falta una variable nueva, `GOOGLE_DRIVE_SYH_FOTOS_FOLDER_ID`, y que alguien
cree esa carpeta en la unidad compartida. Va en `docs/VARIABLES-VERCEL.md`.

**El respaldo es respaldo y no la fuente.** La app lee siempre de Storage. Si
Drive falla, se anota y se reintenta; no se le muestra a nadie un link de Drive.

**Y por eso el respaldo no frena la primera entrega.** El módulo sale con las
fotos en Storage; `respaldada_en_drive_el` queda en null, que es lo que el
modelo ya permite, y el cron se enciende cuando la carpeta exista y la variable
esté puesta. Si no, esto depende dos veces de que una persona haga algo antes de
que nadie pueda usar nada.

**El bucket lo crea una migración**, como `execution-photos` en la 006. Ahí se
declara `allowed_mime_types`, y **esa lista y la de la ruta se escriben en el
mismo momento**: `image/jpeg`, `image/png`, `image/webp`, `image/heic`. Es la
misma de Mantenimiento, y lo que no va es `image/heif` — cuando la ruta lo
aceptaba y el bucket no, una foto HEIF se rechazaba con un 502 que no explicaba
nada. Si se suma un tipo, va en los dos lados.

---

## La carga sin señal

El formulario entra en **`/cargar`** como tercer tipo, al lado del aviso y la
OT. Lo que ya está hecho y se aprovecha:

- La cola en el teléfono (`public/cola/colaOffline.js` + IndexedDB), que guarda
  lo que no se pudo mandar, lo reintenta sola cuando vuelve la conexión y no
  deja que dos disparos manden lo mismo.
- El catálogo guardado en el teléfono (`app/cargar/catalogos.ts`), que ya trae
  equipos, sectores y operarios. **Hay que sumarle el glosario de peligros**,
  que es el único desplegable nuevo.
- La sesión recordada, que firma la carga con quien la hizo y no con quien
  tenga el teléfono después.

**El permiso, en una pantalla que no puede preguntar.** `/cargar` vive **fuera**
del grupo `(app)` justamente para dibujarse sin servidor, su propio encabezado
dice que «no filtra nada» incluye el módulo, y el service worker la sirve para
cualquier navegación que se quede sin red. O sea que alguien sin el módulo puede
llegar ahí. El aviso aguanta eso porque su alta no pide permiso ninguno; la OT
aguanta porque un 403 es definitivo y la carga simplemente queda parada, sin que
se haya perdido nada irrecuperable.

Para una condición insegura, un 403 después del hecho se lleva puesto el único
campo que el diseño dice que no se recupera: la foto ya se sacó, el cardán ya se
protegió, y la carga queda parada para siempre.

Así que: **el grant del módulo se guarda en el teléfono junto con los catálogos,
y la tarjeta del formulario no se le muestra a quien no lo tenga.** La ruta de
alta igual exige `edicion` —el teléfono no decide permisos—, pero el rechazo
deja de ser la forma normal de enterarse. Un grant que cambió y todavía no se
refrescó puede dar un falso positivo; eso termina en una carga parada, que es
recuperable dándole el módulo a esa persona y volviendo a disparar la cola.
(Decisión mía. La otra salida honesta era abrir el alta a cualquier usuario
activo, como el aviso, pero eso da vuelta la decisión 3 y no me corresponde.)

**Y acá está la parte difícil, que hay que mirar de frente: la cola de hoy no
lleva fotos.** Una `CargaEnCola` tiene un `cuerpo` que es JSON y se manda como
JSON a la ruta de alta. El formulario offline de aviso **no tiene campo de
foto** justamente por eso; el que sí la tiene es el modal online, que sube la
foto primero —con señal— y después manda el link.

Para condiciones inseguras eso no alcanza: **la foto es el campo que no se puede
recuperar después.** Se saca parado adelante del problema, y cuando el problema
se arregla ya no hay nada que fotografiar.

Mi recomendación, y queda al constructor confirmarla contra el código: guardar
el archivo como `Blob` en IndexedDB junto a la carga, y que el envío —tanto el
de la pantalla como el del service worker— mande `FormData` en vez de JSON para
este tipo. Un service worker puede armar un `FormData` y un `Blob` sobrevive en
IndexedDB sin convertirse a base64, que infla un tercio y es lo que haría
reventar el almacenamiento del teléfono con diez fotos esperando.

Eso toca piezas compartidas con los otros dos tipos de carga. **Lo que no puede
pasar es que el aviso y la OT cambien de comportamiento**: hoy andan, y el
archivo de la cola tiene escrito por qué cada cosa es como es. Conviene que el
plan trate esto como su propio paso, con sus tests, antes de tocar nada más.

Si al abrirlo resulta más caro de lo que parece, la salida razonable es un
primer corte donde el formulario funciona sin señal para todo menos la foto, y
la foto espera a tener conexión dentro de la misma carga. Pero es un corte, no
el destino: hay que decirlo.

**Ese corte sólo es posible porque la foto no es obligatoria.** Lo es en la
tabla y en la ruta: las 44 que se migran entran sin foto y no se les inventa un
placeholder. El formulario del teléfono la pide —arranca con la cámara, que es
el primer campo— pero deja guardar sin ella. Si fuera obligatoria de verdad, el
corte de arriba equivaldría a que el formulario no ande sin señal, que es lo
contrario del objetivo, y el camino del `Blob` dejaría de ser una recomendación
para ser el único.

---

## Permisos

Como cualquier módulo del SdG: un valor nuevo en el enum `modulo`, grants en
`usuario_modulos`, y los tres niveles que ya existen.

| Nivel | Puede |
|---|---|
| `lectura` | ver la tabla y las fotos |
| `edicion` | lo anterior, y **cargar** una condición |
| `admin` | lo anterior, y **evaluar el riesgo, asignar y cerrar** |

Pedro y Maxi con `admin`; el que haga falta después, con `edicion`.

**Corregir y reabrir, que la tabla de arriba no cubría.** `edicion` puede
corregir los campos de la primera etapa —lugar, descripción, peligro, acción,
prioridad— de **cualquier** condición que no esté cerrada, y agregar o sacar
fotos. No es generosidad: la migración deja a propósito `peligro_id` en null en
las 44 filas y el lugar en null en algunas, así que **la pantalla de gestión
tiene que poder completar campos de la primera etapa o esas 44 quedan
incompletas para siempre.** `admin` puede además corregir lo que ya se evaluó y
**reabrir** una cerrada, que es borrarle la fecha de ejecución.

Es un equipo de dos o tres personas mirando la misma lista; poner cada fila
detrás de quien la cargó resolvería un problema que no existe y dejaría el
trabajo trabado el día que alguien no esté.

Tres funciones en la base, calcadas de las de Calidad
(`20260916090409_calidad_schema.sql`): `tiene_acceso_syh()`,
`puede_editar_syh()`, `es_admin_syh()`. Y lo que ese archivo deja escrito y vale
acá: **tienen que decir lo mismo que el `auth.ts` del módulo.** Cuando no
coincidieron, un `admin_sistema` veía los botones y RLS le devolvía listas
vacías.

**El enum viaja solo.** Es la trampa #1 del README de migraciones y ya mordió
dos veces: un valor nuevo de enum no se puede usar en la misma transacción en
que se agrega (`55P04`). Una migración con `alter type modulo add value
'seguridad_higiene'` y nada más; el schema, las funciones y las policies van en
un archivo posterior.

**Y las policies llaman a su función envuelta**: `using ((select
tiene_acceso_syh()))`, no `using (tiene_acceso_syh())`. Escribirla pelada no
rompe nada y no avisa — la tabla simplemente empieza a costar proporcional a sus
filas. El 14/10/2026 eso tenía a `calculos_diarios` en timeout.

---

## Avisos

El módulo entra al resumen diario con **dos avisos**, los dos a la campana y al
push, porque salen del mismo lugar:

- **condiciones vencidas** — pasó la fecha máxima y no hay fecha de ejecución;
- **condiciones sin completar** — le falta alguna de las tres cosas: la
  evaluación, la asignación o el lugar.

El segundo es **uno solo y no tres** por una razón concreta: una condición a la
que le pusieron los cinco puntajes pero nunca le asignaron responsable ni fecha
máxima **no puede vencer nunca** —no hay fecha que pase— y dejaría de ser "sin
evaluar". Con un aviso por cada cosa, esa fila desaparece de los dos y del push
para siempre, que es exactamente lo que el objetivo dice que no puede pasar.
Juntos, no hay por dónde escaparse.

**Van a quienes tengan el módulo en nivel `admin`**, que son los que pueden
evaluar, asignar y cerrar. Es la lección de `compras-por-aprobar`, que le
llegaba a 6 personas de las cuales 3 no podían aprobar: un push diario sobre
trabajo que uno no tiene permiso de hacer es exactamente cómo alguien apaga las
notificaciones.

Ninguno es un aviso al instante. No pasan el filtro de
`lib/core/avisoAlInstante.ts`: una condición que acaba de cargarse no tiene a
nadie nombrado esperando —todavía no se asignó responsable— y nada se frena
hasta que alguien decida. El resumen de las 8:30 alcanza.

El segundo aviso es el que sostiene el anti-objetivo: si el riesgo sin evaluar
no aparece todos los días en el teléfono de quien tiene que evaluarlo, vuelve a
pasar lo del Excel.

Y una del repo que muerde justo en el estreno: la `cantidad` de un aviso se
compara contra la foto del día anterior, así que **el día que entren las 44
migradas el primer resumen va a anunciar «+35 · Condiciones sin completar»**,
una novedad que no pasó, y después va a callarse por semanas mientras esas 35
siguen ahí. Hay que **escribir la foto del día (`avisos_fotos`) inmediatamente
después de correr la migración**, antes del primer cron. Los lunes, que mandan
totales, se encargan del resto.

(La otra regla del mismo tema, por si se toca después: si cambia **qué** cuenta
un aviso, va con id nuevo.)

**Esto es decisión mía, no del usuario.** Si los dos avisos sobran, se sacan
antes de escribirlos.

---

## Migrar lo que hay

Las **44 condiciones** del `.xlsm` entran. Son el trabajo abierto de este mes:
40 pendientes, 3 cerradas y 1 vencida. Empezar vacío sería pedirle a alguien que
las copie a mano o, más probable, que siga usando el Excel en paralelo.

Entra lo que es dato y no se puede recuperar de otro lado:

- los 9 juegos de puntajes que sí se cargaron;
- el sector como texto, resuelto contra el catálogo **y dejado en null cuando no
  se reconoce con certeza**. Es la regla del repo y vale entera acá:
  `Planta 2` y `Planta 02` son el mismo lugar y hay que unificarlos a mano, pero
  `Cal` o `Deposito abierto` puede que no sean nada del catálogo. **Enlazar al
  que se le parece es peor que dejar en null**: un enlace equivocado no se nota
  nunca.
- el responsable y el que detectó, resueltos contra `usuarios` por nombre, con
  la misma regla: si no hay certeza, queda en null y se informa. Son dos
  nombres ("Maxi Lenzetti", "Francisco Varela") y uno ("Pedro Arias"): se
  revisan de a uno, no con un algoritmo.

**No entra** el peligro, porque la planilla no tiene esa columna: está dentro de
la descripción ("riesgo de atrapamiento"). Deducirlo con una búsqueda de texto
es exactamente el enlace al que se le parece. Queda null y lo completa quien
gestione.

**Las 52 fotos no se pueden migrar desde el archivo**: son links a un disco. Hay
que pedirle a quien tenga esa carpeta que la mande, y subirlas por nombre — los
nombres están en las columnas W en adelante de la planilla (`Fotos\1.jpg`,
`Fotos\IMG_20261010_083540203.jpg`). Si no aparece, las 44 condiciones entran
sin foto y hay que decirlo — no inventar un placeholder.

El `.xlsm` de origen es `21-10-26.xlsm` y al 29/10/2026 estaba en la carpeta de
descargas de quien lo mandó, no en el repo. **Antes de escribir el script hay
que tenerlo a mano**; el glosario y los criterios ya no dependen de él (están en
el apéndice), pero las 44 filas sí.

El script de migración va en `scripts/`, corre una vez, y **no es una
sincronización**: no hay nada que volver a leer después. Lo último que hace es
escribir la foto de avisos del día, por lo que está explicado más arriba.

---

## Lo que se decidió por mi cuenta

Todo esto lo elegí yo mientras escribía, y lo marco para que se pueda revisar
sin leer el documento entero:

1. **Sin planilla de Google.** El módulo nace en el SdG y no espeja nada. Hay
   dos razones: la planilla de origen es de otra empresa y está rota, así que no
   hay nada que mantener vivo del otro lado; y el 19/10/2026 se acordó dar
   vuelta los cinco espejos que quedan para que los llene el sistema. Nacer con
   un espejo nuevo sería caminar en contra. Si mañana alguien de afuera tiene
   que mirar esto, se exporta.
2. **El bucket va privado**, con links firmados.
3. **El estado se deriva, no se guarda.**
4. **`probabilidad`, `gravedad` y `nivel_riesgo` son columnas generadas.**
5. **Los dos avisos del resumen diario**, a los `admin` del módulo, y ninguno
   al instante; con el segundo juntando las tres incompletitudes en uno.
6. **Migrar las 44**, con la regla de null antes que un enlace dudoso, y
   escribir la foto de avisos justo después para no anunciar un salto falso.
7. **Prefijo `syh_`** y los nombres de ruta y carpeta.
8. **Una tabla aparte para las fotos.**
9. **Un bucket nuevo** en vez de reusar `execution-photos`, privado, con los
   cuatro tipos de imagen de Mantenimiento.
10. **Blob en IndexedDB + `FormData`** como dirección recomendada para la foto
    offline — con el corte alternativo escrito arriba si resulta más caro.
11. **La foto no es obligatoria** en la tabla ni en la ruta; el formulario la
    pide primero pero deja guardar sin ella.
12. **El lugar es obligatorio en el alta del teléfono y no en la tabla**
    (`num_nonnulls(...) <= 1`), para que la migración pueda dejar null.
13. **`edicion` corrige la primera etapa de cualquier condición abierta;
    `admin` corrige todo y reabre.**
14. **El grant del módulo se cachea en el teléfono** y la tarjeta no se le
    muestra a quien no lo tenga.
15. **El respaldo en Drive no bloquea la primera entrega.**

---

## Lo que queda al constructor

- La forma exacta de las dos pantallas: qué columnas se ven primero, qué filtros
  hay, cómo se ve una ficha con cinco fotos. La única condición fuerte es la del
  anti-objetivo: **lo que falta tiene que verse antes que lo que está completo.**
  Y dos reglas del repo que muerden justo acá: un desplegable se escribe
  `<Select>` y no `<select>` —el glosario tiene 32 opciones y sin buscador se
  recorre con la rueda—, y una grilla de tres columnas lleva breakpoint, porque
  esto se usa en un teléfono de 375 px.
- Cómo se resuelve la foto en la cola offline, contra el código real.
- Si el número correlativo se guarda o se deriva.
- El detalle del cron de respaldo: cada cuánto, de a cuántas, qué pasa si una
  foto falla tres veces.
- Todo lo normal: nombres de archivos, estructura de componentes, qué se saca a
  función pura para poder testearlo.

## Lo que hay que mirar antes de escribir una línea

- `supabase/migrations/README.md` — las ocho trampas. Dos de ellas aplican
  directo: el enum que viaja solo y la función en un índice que necesita cast.
- `supabase/migrations/20260916090407_calidad_enum_del_modulo.sql` y
  `20260916090409_calidad_schema.sql` — el módulo más parecido, y el más nuevo
  que hizo este camino entero.
- `app/api/mantenimiento/fotos/route.ts` — la ruta de fotos que ya existe.
- `public/cola/colaOffline.js` y `app/cargar/` — la cola y sus dos formularios.
- `scripts/backup/subir-a-drive.mts` — la cuenta de servicio y la unidad
  compartida.
- `lib/core/auditoria.ts` — **cerrar una condición no se deshace.** Ver abajo.

### Una cosa que es fácil olvidarse

Cerrar una condición insegura pone una fecha de ejecución y la saca de la lista
de lo que hay que arreglar. Mirado contra los nueve verbos que ya audita el
sistema, se parece bastante a cerrar una liquidación o a cerrar una recepción de
Despacho. **Mi lectura es que no hace falta auditarlo**: a diferencia de esos
dos, no mueve plata ni stock ni escribe en Odoo, y se puede volver atrás
borrando la fecha. Pero lo dejo escrito acá en vez de callármelo, porque la
auditoría la escribe la aplicación y no un trigger: es lo único que puede
olvidarse, y la pregunta correcta es si la ausencia de una condición de la lista
puede hacerle daño a alguien. Si la respuesta de quien lo construya es que sí,
el verbo `cerrar` ya existe y no necesita migración.

---

## Apéndice — lo que hay que copiar del Excel

Transcripto acá a propósito: el `.xlsm` de origen no está en el repo, es una
copia de la planilla de otra empresa y no hay nadie manteniéndolo. Esto es lo
único que de ahí vale la pena, y a partir de acá el documento se vale solo.

### Los 32 peligros

Van como filas de `syh_peligros`, con su descripción. Se copian tal cual, con
sus rarezas: "Torceduras" no tiene descripción, y "Caída de altura" dice *"Caída
que se produce por encima de los dos metros. (< 2m)"* — el texto se contradice a
sí mismo y así está en el original. Son del glosario, no de una norma: se
transcriben, no se corrigen.

Agresión de terceros · Ambiente térmico inadecuado · Arco eléctrico · Atmósfera
inadecuada · Atrapado por · Atropellamiento por vehículos · Caída a desnivel ·
Caída a nivel · Caída de altura · Choques contra · Contacto con sustancias
químicas · Contacto directo · Contacto indirecto · Cortes/Pinchaduras ·
Desprendimiento de tierra / escombros · Ergonómicos · Explosión · Exposición a
radiaciones ionizantes · Golpeado por · Golpeado contra · Iluminación
deficiente · Incendio · Inhalación de partículas / gases o sustancias tóxicas ·
Mordeduras / picaduras · Proyección de partículas · Quemaduras · Radiación no
ionizante · Radiaciones ionizantes · Ruidos y vibraciones · Salpicaduras ·
Torceduras · Vuelco de vehículos

(Las descripciones completas están en la hoja `Glosario Peligros`. "Radiación no
ionizante" y "Radiaciones ionizantes" conviven con "Exposición a radiaciones
ionizantes": tres entradas para dos cosas. Es del original; que lo limpie quien
use el módulo, no quien lo construya.)

### Los cinco criterios, con su texto

**Frecuencia** (probabilidad)

| Pts | Opción |
|---|---|
| 3 | **Diaria.** Muy frecuente |
| 2 | **Media.** Su frecuencia es mayor a un día pero no alcanza el mes |
| 1 | **Mensual o mayor.** El peligro se repite esporádicamente |

**Antecedentes de accidentes** (probabilidad)

| Pts | Opción |
|---|---|
| 3 | Reiterados antecedentes de accidentes, enfermedades y/o fallas. Antecedente de accidentes mortales o de incapacidad permanente |
| 2 | Se conocen antecedentes. Incidentes que casi desencadenaron el accidente y/o fallas, durante el último año calendario |
| 1 | No se conocen antecedentes |

**Controles y capacitación** (probabilidad)

| Pts | Opción — requiere al menos uno de |
|---|---|
| 5 | Equipos especiales o EPP específicos · Capacitación específica para poder realizar la tarea |
| 3 | Requiere instructivo · Permisos de trabajo · EPP básicos (casco, calzado, lentes y/o protectores auditivos) · Equipos no especiales |
| 1 | Capacitación básica de SH&MA · No requiere procedimientos ni permisos de trabajo · No se requiere EPP para realizar la tarea |

**Magnitud del daño** (gravedad)

| Pts | Opción |
|---|---|
| 9 | Puede producir muerte, amputaciones, lesiones invalidantes o múltiples, envenenamientos, enfermedades ocupacionales permanentes, fracturas mayores; daños que provocan parada o interrupción del servicio, o con costo de reparación elevado, o que comprometen la estructura y la funcionalidad de las instalaciones; alta o media tensión |
| 7 | Puede producir quemaduras localizadas, laceraciones, fracturas menores o lesiones musculares, dermatitis, lesiones a la vista, problemas auditivos o respiratorios; daños parciales con costo accesible, que no interrumpen la actividad y no comprometen la estructura pero sí la funcionalidad; baja tensión |
| 3 | Riesgos fácilmente solucionados, sin acción severa sobre la salud: lesiones superficiales, cortes o contusiones menores, irritación, afecciones temporarias; daños materiales menores con costo bajo, sin comprometer estructura ni funcionalidad; sin tensión |

**Legislación aplicable** (gravedad)

| Pts | Opción |
|---|---|
| 5 | El peligro está regulado por legislación aplicable específica |
| 3 | El peligro está regulado pero no es de aplicación directa |
| 1 | El peligro no está regulado por ningún requisito legal aplicable |
