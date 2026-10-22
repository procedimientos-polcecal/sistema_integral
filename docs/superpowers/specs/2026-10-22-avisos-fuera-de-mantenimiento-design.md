# Avisar no es entrar a Mantenimiento

**22/10/2026 · acordado, sin empezar**

## Qué problema resuelve

Un aviso dice que algo anda mal en una máquina. Es el primer eslabón de todo el
módulo de Mantenimiento: de un aviso sale después una orden de trabajo.

Pero **quien ve que algo anda mal no trabaja en Mantenimiento**. Trabaja en
Producción, en Cantera, en el laboratorio. Hoy la única pantalla para cargar un
aviso vive adentro de `/mantenimiento/avisos`, y ese módulo no lo tiene todo el
mundo. Así que esa gente avisa por un **Google Forms**, afuera del SdG, que cae
en la planilla y de ahí lo importa el sistema.

Es exactamente la situación que Compras ya resolvió con **"Mis pedidos"**:
cualquiera puede pedir un material aunque no trabaje en Compras, porque pedir no
compromete nada — aprobar y comprar sí, y eso quedó adentro del módulo. Avisar
es lo mismo: contar que una máquina hace un ruido raro no compromete nada.

Esto saca el alta de avisos de adentro del módulo y la pone donde está
"Mis pedidos": un ítem propio, visible para cualquiera con sesión.

## Lo que se midió antes de decidir

Todo esto es contra la base de producción, el 22/10/2026.

**Nadie cargó nunca un aviso desde la app.** De 184 avisos, `app_created` es
falso en los 184. Los 184 entraron por el Forms. No es casualidad: la ruta de
alta exige **nivel de edición en Mantenimiento**, y de 14 usuarios activos sólo
8 tienen el módulo —4 en lectura, 1 en edición, 3 admin—. O sea que hoy
**4 personas de 14** podrían cargar un aviso desde el sistema, y ninguna de las
cuatro que más avisa está necesariamente entre ellas. No había otra puerta que
el Forms.

**Los que avisan son ocho, y cuatro ya están mapeados a un área.** La tabla
`usuario_areas_compras` tiene cargadas 4 personas de 14, y son justo las que
cargan los avisos:

| Quién | Área | Avisos |
|---|---|---|
| Martin Sandoval | Producción | 88 |
| Luna Fourcade | Cantera | 53 |
| Mayra Benitez | Laboratorio | 13 |
| Alejandro Garnica | Laboratorio | 5 |

Son **165 de los 184**. La pieza que "Mis pedidos" usa para decidir qué mostrar
primero ya describe a los encargados que avisan; lo único que está mal es el
nombre de la tabla, que dice "de Compras".

**`quien_aviso` es texto libre y ya no matchea consigo mismo.** La misma persona
está escrita de cuatro formas: `MARTIN SANDOVAL` (66), `MARTIN  SANDOVAL` con
dos espacios (15), `Martin Sandoval` (5), `Martín  Sandoval` (2). Luna Fourcade
igual: `Luna Fourcade` (43) y `Luna  Fourcade` (10). Son 88 y 53 avisos bajo
nombres que una comparación de texto da por distintos.

**El sector no sirve como filtro.** Hay 41 sectores de planta y los nombres se
repiten: `Mantenimiento` aparece 4 veces, `Producción` 4, `Administración` 3,
`Calidad` 3. "Los avisos de mi sector" sería ambiguo. Las 9 áreas de Compras
—Almacén, Cantera, Despacho, Inversiones, Laboratorio, Mantenimiento, OTRA,
Producción, Taller Vial— son limpias.

**La foto está creciendo y la app no la tiene.** 15 de los 184 avisos traen
foto, pero **11 de esos 15 son de los últimos 51**: de agosto para acá, uno de
cada cinco. El Forms permite adjuntarla y la planilla la guarda en la columna K.
El alta que hoy tiene la app no tiene foto ninguna.

**"¿Se convirtió en OT?" se contesta con texto, no con un enlace.**
`ot_asignada` tiene el número de OT en 181 de 184 —`1989`, `1532`, `2119`—,
mientras que `work_order_id`, que es el enlace de verdad contra
`ordenes_trabajo`, está puesto en **2**. Hay además 3 avisos que dicen
`Revision` y 2 que dicen `-`.

## Qué se decidió

**Un ítem hermano de "Mis pedidos", con la misma forma.** Se llama
**"Mis avisos"**, vive en `/mis-avisos` y va en `NAV` **sin `modulo`**, pegado
debajo de "Mis pedidos". Cualquiera con sesión lo ve.

**La pantalla muestra los avisos de mi área, no los que cargué yo.** Decidido
explícitamente: Martín tiene que ver todos los de Producción, los haya cargado
quien los haya cargado. Es la misma decisión que tomó la migración
`20260904103615` para los requerimientos, y por el mismo motivo.

**Y tiene un botón para ver todos.** Igual que "Mis pedidos": buscar antes de
avisar es lo que evita que dos personas reporten la misma falla la misma semana.

**Cada aviso dice en qué terminó.** Es lo que al que avisa le importa y es lo
único que el Forms no le puede dar: mandás el formulario y no te enterás nunca
más. Son tres estados y la función que los decide **ya existe**:
`finalDelAviso()` de [lib/mantenimiento/desestimarAviso.ts](../../../lib/mantenimiento/desestimarAviso.ts),
con sus tests, incluida la regla de que tener OT le gana a estar desestimado.
Se reusa; no se escribe una segunda copia.

**La foto entra ahora, no cuando el Forms esté por apagarse.** Decidido a
pedido. El Forms y la pantalla conviven un tiempo y después el Forms se apaga
—eso ya está acordado aparte—, y el día que se apague la foto se iría con él sin
que nada avise.

**El número de OT se linkea sólo para quien tenga el módulo.** Decidido a
pedido. `/mantenimiento/ordenes` rebota a `/` a quien no tenga Mantenimiento,
que son 10 de los 14 usuarios y justo los destinatarios de esta pantalla. Quien
no lo tenga ve el número pelado; quien lo tenga, un link. Sí, dos personas
mirando la misma pantalla ven cosas distintas — y la alternativa es un link que
rebota, que la regla de `nav.ts` ya rechazó una vez: mostrar un ítem que rebota
es peor que no mostrarlo.

**Cargar un aviso deja de pedir nivel de edición en Mantenimiento.** Lo puede
hacer cualquier usuario activo del sistema, que es como la migración 018 dejó el
alta de un requerimiento.

## Lo que NO es

- **No manda una notificación cuando el aviso se vuelve OT.** Es tentador y no
  pasa el filtro de `avisarAQuienDecide()`: no hay una persona nombrada
  esperando una decisión y **nada se frena** mientras tanto. Las tres
  condiciones están escritas en el encabezado de
  [lib/core/avisoAlInstante.ts](../../../lib/core/avisoAlInstante.ts) y ésta
  falla dos. La pantalla contesta la pregunta; eso es lo que se pidió.
- **No resuelve los 179 `ot_asignada` que son texto.** El número se muestra tal
  cual —"OT 1989"— y se enlaza a la orden **sólo** cuando `work_order_id`
  existe y quien mira tiene el módulo. Resolver los 179 contra
  `ordenes_trabajo` es otra tarea, y una que tiene que decidir qué hacer con
  `Revision` y con `-`.
- **No construye una vista de la OT para quien no tiene Mantenimiento.** Sería
  la respuesta más completa a "¿en qué terminó?" —el que avisó podría leer qué
  se hizo— y es una segunda pantalla entera. Se evaluó y quedó afuera a pedido.
- **No toca `/cargar`, la pantalla de cargar sin señal.** Sigue gateada a
  Mantenimiento. Queda una asimetría conocida y vale escribirla: alguien de
  Cantera va a poder avisar desde el teléfono con señal y no sin ella, que es
  justamente donde está la cantera. Es trabajo aparte.
- **No apaga el Forms.** Esa decisión ya está tomada y configurada fuera de acá.
- **No audita.** Cargar un aviso no es irreversible.
- **No rehace `/mantenimiento/avisos`.** Se toca lo mínimo para que muestre el
  área y la foto, y nada más.

## Qué haría que esto fracase aunque funcione

Tres cosas, y las tres tienen su defensa en el diseño de abajo:

1. **Que la pantalla abra vacía el primer día.** Es lo que le pasó a "Mis
   pedidos" cuando filtraba por `solicitante_id`: esa columna estaba en null en
   los 1.947 requerimientos y la pantalla estaba vacía para todo el mundo. Acá
   pasaría igual si "mis avisos" quisiera decir "los que cargué yo": hay 0
   avisos cargados desde la app. Por eso el filtro es por área **y** por eso los
   184 que ya están se rellenan.
2. **Que el Forms siga siendo el único lugar donde se puede mandar una foto.**
   Entonces el que tiene una foto —uno de cada cinco— vuelve al Forms, y quedan
   dos puertas abiertas para siempre.
3. **Que `quien_aviso` sume una quinta forma de escribir "Martín Sandoval".**
   Si el campo sigue siendo un `input` vacío, eso es exactamente lo que va a
   pasar.

## Cómo se arma

### La base

Una migración, con marca de tiempo (`npm run migracion`). Tres cosas:

**1. `avisos` se puede leer.** Hoy la lectura está cerrada con
`mant_puede_ver()` desde la migración 029, así que alguien de Producción no ve
ni uno. Se abre a cualquier autenticado, que es lo que la 018 hizo con
`compras_requerimientos` y con la misma razón escrita: el circuito es
transversal a toda la empresa.

> **Esto revierte en parte a la migración `20260916110349`**, que cerró siete
> tablas de Mantenimiento justamente porque el asistente de IA hereda lo que
> dicen las policies y no filtra por su cuenta. Abrir `avisos` quiere decir que
> cualquiera que pueda usar el asistente va a poder preguntarle por los avisos.
> Es deliberado —es el mismo trato que ya tiene `compras_requerimientos`, y el
> mismo que tiene `equipos`, que esa migración dejó abierto a propósito— pero
> tiene que quedar escrito en el encabezado de la migración nueva, porque dentro
> de seis meses va a parecer un descuido.

La policy nueva es `using (true)`: no hay función que envolver, así que la regla
del `(select ...)` no aplica acá.

**Las policies de escritura no se tocan.** La ruta de alta inserta con
`createAdminClient()`, así que RLS no es lo que la frena — lo que la frena es el
chequeo de permiso de la ruta.

**2. `avisos` gana dos columnas.**

- `area_id uuid references compras_areas(id)` — de qué área es el aviso.
- `creado_por uuid references usuarios(id)` — quién lo cargó desde el sistema.

`creado_por` no reemplaza a `quien_aviso`: ése sigue existiendo porque **viaja a
la columna G de la planilla** y porque la planilla la sigue llenando gente desde
el Forms. `creado_por` es el dato del sistema y arranca en null en los 184.

> **El FK a `compras_areas` acopla una tabla de Mantenimiento con una de
> Compras**, y eso hay que decirlo en el comentario en vez de dejarlo pasar. En
> los hechos esa tabla ya es un catálogo del núcleo: es "de qué área de la
> empresa es esto", no "de qué área de Compras". Es el mismo caso que `equipos`,
> que la `20260916110349` dejó documentado como catálogo del núcleo en vez de
> moverlo. Mover `compras_areas` al núcleo es un cambio de diseño, no un ajuste,
> y no es parte de esto.

**3. Se rellena el área de los 184 que ya están.** Cruzando `quien_aviso` contra
`usuarios` y de ahí a `usuario_areas_compras`. Lo que se espera: **165 de 184
quedan con área, 19 quedan en null.**

Cómo se compara, que es donde esto se puede romper en silencio:

- Se normaliza de los dos lados: minúsculas, **acentos afuera** y espacios
  colapsados. `Martín  Sandoval` y `MARTIN SANDOVAL` tienen que dar lo mismo.
  Sin colapsar espacios, los 15 avisos con dos espacios se pierden.
- **Match exacto sobre el normalizado, nunca parecido.** La regla del sistema es
  que enlazar al que se le parece es peor que dejar en null: un aviso en el área
  equivocada no se nota nunca, simplemente aparece en la pantalla de otro.
- **Antes de aplicarlo, comprobar que dos usuarios no normalicen igual.** Sacar
  los acentos convierte `ñ` en `n`, así que dos apellidos distintos pueden
  colisionar. Son 14 usuarios: se mira. Si dos colisionan, los dos quedan en
  null.
- Una persona puede tener **más de un área** en `usuario_areas_compras` — la
  tabla existe justamente por eso. Si tiene dos, el aviso queda en null y se
  informa, por la misma razón que arriba. Hoy ninguna de las cuatro tiene dos.

Los 19 que quedan afuera no son un error del código: **Francisco Varela (9
avisos) y Maximiliano Lenzetti (2) son usuarios activos sin área cargada**, y
hay 1 aviso con `quien_aviso` vacío. Se arregla cargándoles el área en
Administración → Usuarios, no tocando código. Conviene decírselo al usuario
cuando esto se entregue.

### El área también la tiene que poner el importador, no sólo el modal

**Ésta es la trampa que hunde la pantalla a la semana de entregada, y hay que
escribirla antes de empezar.** El Forms sigue prendido un tiempo, así que los
avisos van a seguir entrando por `sincronizarAvisos()` de
[lib/mantenimiento/sincronizar.ts](../../../lib/mantenimiento/sincronizar.ts).
Ese camino arma su payload con `filaDeAviso()` y no sabe nada de áreas — y la
planilla no tiene columna de área de donde leerla. Si sólo se rellenan los 184 y
se completa desde el modal, **todo lo que llegue del Forms a partir de mañana
cae con `area_id` en null y no aparece en la pantalla de nadie**. Los 88 avisos
de Martín quedan como un conjunto histórico congelado y la pantalla deja de
servir sin que nada avise.

Así que la misma resolución —nombre normalizado → `usuarios` →
`usuario_areas_compras`— tiene que vivir en una función de `lib/` que llamen los
tres caminos: el relleno de la migración, el alta y la sincronización.

**Y en la sincronización va sólo para las filas que todavía no tienen área.** El
upsert de PostgREST escribe **todas** las columnas que estén en el payload, así
que mandar `area_id` en todas las filas pisaría con un null el área que alguien
eligió en el modal, o la que alguien corrigió a mano, en la próxima corrida. Es
el mismo tipo de error que la regla de `borradoDeEspejo`: sólo se toca aquello
cuya ausencia prueba algo.

### El alta

**Se reusa el modal que ya existe**, igual que "Mis pedidos" reusa
`NuevoRequerimientoModal` desde la carpeta de Compras:
`app/(app)/mantenimiento/avisos/NuevoAvisoModal.tsx`. Una segunda copia del
formulario son dos formularios que van a decir cosas distintas dentro de tres
meses.

Tres cambios en ese modal:

- **`quien_aviso` viene precargado** con el nombre y apellido de quien tiene la
  sesión. Editable, porque Martín carga lo que le cuentan los de Producción y a
  veces el que vio la falla es otro. Precargado es lo que corta la quinta
  ortografía.
- **El área** sale de `usuario_areas_compras` de quien carga. Si tiene una, va
  esa y se puede cambiar. Si no tiene ninguna **o tiene dos**, hay que elegirla
  —y el cartel tiene que decir por qué, como hace "Mis pedidos" cuando alguien
  no tiene área—. Con dos no se adivina: esa tabla existe justamente porque una
  persona puede cubrir más de un área.
- **La foto.** Sube por `POST /api/mantenimiento/fotos`, que ya existe y ya
  resuelve lo difícil: va a Supabase Storage y no a Drive, porque una cuenta de
  servicio de Google no tiene cuota de Drive. Esa ruta **también** exige nivel
  de edición en Mantenimiento y también hay que abrirla.

**El permiso de las dos rutas** —`POST /api/mantenimiento/avisos` y
`POST /api/mantenimiento/fotos`— pasa de `puedeEditarMantenimiento` a "cualquier
usuario activo con sesión". El 401 por falta de sesión queda igual.

**`area_id` NO puede ser obligatorio en la ruta.** Esto parece un detalle y es
un aviso que se pierde para siempre: `app/cargar/FormularioAvisoOffline.tsx`
postea a esa misma ruta y no sabe nada de áreas, y **para la cola de cargas sin
señal un 400 es definitivo** — el aviso quedaría parado con un error sobre un
campo que su propio formulario no tiene. Lo mismo vale para el asistente, que
arma una URL con valores iniciales y tampoco lleva área.

Entonces: si el cuerpo no trae `area_id`, la ruta lo resuelve igual que el
importador, **y sólo cuando la persona tiene exactamente un área**. Con cero o
con dos queda en null, que es visible y corregible, en vez de adivinado.

> Ojo con esto: esas rutas las usa también `/cargar`, la pantalla de cargar sin
> señal. Abrirlas es correcto y es lo que se quiere; lo que no cambia es el
> **menú**, que sigue gateado a Mantenimiento.

**La foto del aviso va a su propio prefijo en el bucket.** Hoy la ruta arma
`ordenes/<ot>/<timestamp>.<ext>` y, sin número de OT, cae en `ordenes/sin-ot/`.
Un aviso no es una orden: va `avisos/<oa>/`. Dentro de seis meses, "sin-ot" no
le va a decir nada a nadie, que es el motivo por el que esa ruta ya arma nombres
con sentido.

> Y una inconsistencia chica que conviene cerrar de paso, porque con la foto
> como función se vuelve visible: la ruta acepta `image/heif` en su lista
> `TIPOS` pero el bucket no lo tiene en `allowed_mime_types`. Una foto HEIF pasa
> el chequeo de la ruta y la rechaza Storage con un 502 que no explica nada. Se
> arregla de cualquiera de los dos lados; da igual cuál.

### La planilla, que es donde manda

El aviso se escribe **primero en la planilla y después en la base**, y eso no
cambia: la planilla es la fuente y de ahí lee quien no entra al sistema. El
número de aviso sale de leer la última fila de la planilla, no de la base.

**Hay que agregarle la columna de la imagen a `filaParaLaPlanilla()`.** Hoy esa
función llena el array hasta la L y escribe el número, la fecha, el sector, el
equipo, la descripción, la urgencia, quién avisó y las observaciones — **pero no
la K, que es la imagen**. Una foto cargada en la app que no llegue a la columna
K no existe para quien mira la planilla, y además el importador la va a leer
vacía y pisar lo que había. El mapa de columnas está en `COL` de
[lib/mantenimiento/avisos.ts](../../../lib/mantenimiento/avisos.ts) y la imagen
es el índice 10.

> **`COL` es 0-based y `letraDeColumna()` también.** El 21/10/2026 un script le
> pasó un 6 creyendo que era la F y escribió en la G, y seis órdenes quedaron
> diciendo el equipo equivocado. Lo que lo volvió caro fue que el informe
> imprimía una letra sacada de una constante aparte, así que la pantalla
> confirmaba lo que no había pasado. Acá: `COL.imagen` es 10 y eso es la **K**.
> Comprobar el encabezado de esa columna en la planilla real antes de escribir.

**El bucket `execution-photos` hoy es privado, y hay que hacerlo público.**
Medido contra producción el 22/10/2026: `public: false`. Mientras siga así, la
ruta de fotos devuelve un link firmado que **vence en un año** y que no se abre
desde la planilla, que es donde mira el que no entra al sistema. Decidido a
pedido: el usuario lo cambia a mano en Supabase, igual que aplica la migración,
y **esta tarea depende de ese paso tanto como de las columnas nuevas**.

La ruta ya detecta sola el estado del bucket y devuelve `publica: false` con un
texto que lo explica; hoy eso se muestra en el alta de la OT. La pantalla nueva
tiene que mostrarlo igual: una foto que sólo sirve adentro del sistema es media
foto, y enterarse en silencio es peor.

### El área no va a la planilla, y eso tiene una consecuencia

`area_id` vive sólo en la base, sobre una tabla cuya fuente es la planilla. Es a
propósito: el área es un filtro del sistema —decide qué ve cada uno en su
pantalla— y no un dato del aviso que necesite leer el que abre el Sheets.
Agregarla allá es una columna nueva en la planilla, una entrada más en `COL` y
un campo más que alguien puede escribir mal a mano.

La consecuencia que hay que respetar: **la sincronización nunca tiene que
mandar `area_id` en el payload de una fila que ya la tiene.** Si lo hiciera, un
re-import la borraría en silencio, porque la planilla no la trae. Es la misma
regla del bloque de arriba, vista desde el otro lado.

### La pantalla

Copia la forma de `MisPedidosClient`, incluida la decisión de **traer los datos
desde el cliente y paginar**. Con 184 avisos hoy no haría falta, pero la planilla
crece y la regla del repo es no razonar "esta tabla es chica" — el tablero de
Compras parecía una cola acotada y arrastra 1.900 filas. Si se lee del servidor,
va con `traerTodo()` de `lib/core/paginado.ts`.

Las columnas, que es donde se aparta de "Mis pedidos": **N° OA, fecha, qué pasa,
equipo, área, quién avisó, urgencia y en qué terminó.** La urgencia viene con
emoji desde la planilla —`🟡 Media` (102), `🟠 Alta` (57), `🟢 Baja` (24)—, así
que las opciones del filtro salen de los datos y no de una lista fija, que es lo
que ya hace `AvisosClient`.

Lo que **no** se muestra: nada de lo que Mantenimiento decide adentro. Generar
la OT, desestimar el aviso y sincronizar siguen viviendo en
`/mantenimiento/avisos`, que es de quien es la decisión. Acá se avisa y se mira
en qué terminó.

Tres reglas de pantalla del repo que acá aplican todas:

- Un desplegable se escribe `<Select>` y no `<select>`. El componente decide
  solo si hace falta buscador.
- Una grilla de tres columnas lleva breakpoint: `grid-cols-1 sm:grid-cols-3`. El
  ancho útil en el teléfono son 343 px.
- Un ancho no va en el `input`. `.input` declara `width: 100%` fuera de capa y
  le gana a cualquier `w-*`; el ancho va en un `div` que lo envuelva.

Se comprueba con `node scripts/revisar-responsive.mjs`, que hoy da ROMPE 0.

## Qué queda a criterio de quien lo construya

- Cómo se ve "en qué terminó" —una etiqueta de color, un texto— mientras diga
  las tres cosas distintas y el número de OT cuando lo hay.
- Si el alta se abre con un botón arriba a la derecha o con otra cosa, mientras
  se parezca a "+ Pedir un material".
- El orden exacto de las columnas y qué se esconde en el teléfono.
- Si el filtro por área es un par de solapas como "Mis pedidos" o un
  desplegable.
- Cómo se nombra la migración y en cuántos archivos va. Si el relleno del área
  se separa en su propio archivo, mejor, pero no es un enum: no está obligado.

## Cómo se verifica

Lo de siempre, y en este orden:

```bash
npm test
npx tsc --noEmit
npm run build
node scripts/revisar-arbol-commiteado.mjs
node scripts/revisar-responsive.mjs
```

Tests nuevos sobre funciones puras, que es donde están las decisiones:

- **La normalización del nombre para rellenar el área.** Con los casos reales
  medidos: `MARTIN  SANDOVAL` con dos espacios, `Martín  Sandoval` con acento y
  dos espacios, `Luna  Fourcade`. Y un caso que **no** tiene que matchear.
- **Que la persona con dos áreas quede en null**, de los dos lados: el relleno y
  el alta.
- **`filaParaLaPlanilla()` escribe la foto en el índice 10** y no corre nada de
  lugar. Es la defensa contra repetir lo del 21/10.
- **Que la sincronización no pise un `area_id` que ya está.** Es el test que
  separa "la pantalla anda" de "la pantalla anda hasta la próxima corrida del
  cron".

Y dos cosas que ningún test ve:

- Después de aplicar la migración, **contar**: tienen que quedar 165 avisos con
  área y 19 sin. Si da otro número, la normalización no hace lo que dice.
- `npm run planillas` sigue en ROMPE 0, porque esto le agrega una columna a una
  escritura.

## Dos pasos que no los puede dar un agente

La tarea queda a la espera de los dos, y conviene pedirlos juntos y temprano:

1. **La migración**, que la aplica una persona a mano en el editor SQL de
   Supabase. Hasta que `area_id` y `creado_por` existan, la pantalla no se puede
   probar contra datos reales.
2. **Hacer público el bucket `execution-photos`** en Supabase. Hasta entonces la
   foto entra pero su link no se abre desde la planilla y vence en un año.

Y una tercera que no bloquea pero conviene decir al entregar: **a Francisco
Varela y a Maximiliano Lenzetti les falta el área** en Administración →
Usuarios. Son 11 avisos que van a quedar sin área sin que el código tenga la
culpa, y van a seguir entrando así.
