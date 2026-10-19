# Cargar un aviso o una OT sin señal

Acordado el 18 de octubre de 2026. Es la **fase 4** de las cuatro de
[la app instalable](2026-10-16-app-instalable-design.md), más el pedazo de la
fase 3 que hace falta para que la 4 exista.

## El momento que esto resuelve

El pedido, textual: «estoy en la planta sin señal, queriendo cargar un aviso o
una OT», y «lo cargo en el sistema, y al volver que se actualice».

Eso **no es la fase 3**. La fase 3 —que el SdG abra y muestre lo último que
viste— no resuelve ese momento: ahí nadie está consultando nada, está cargando.
Se arranca por la 4 porque es la que duele, y se trae de la 3 lo mínimo
indispensable.

Y «lo mínimo indispensable» resultó ser más de lo que parecía. La primera
versión de este documento daba por sentado que la pantalla ya estaba abierta.
No lo está: **se llega a la planta y recién ahí se saca el teléfono del
bolsillo**. Preguntado, se confirmó que la app tiene que abrir sin señal. Eso es
lo que decide la forma de todo lo que sigue.

## Qué se encola, y qué no

**Sólo dos cosas: el aviso y la OT de Mantenimiento.** Preguntado
explícitamente qué más se carga en planta, la respuesta fue «nada más». No se
encola nada de Compras, de Inventario, de Envases ni de Producción.

Eso no es una limitación provisoria que convenga levantar después sin pensarlo.
La fase 4 quedó última en el plan de octubre justamente porque **un movimiento
de stock encolado es otra cosa**: aterriza horas después sobre un stock que ya
cambió, y nada avisa. Un aviso y una OT no tienen ese problema —son hechos
nuevos, no ajustes sobre un saldo— y por eso son las dos que se pueden encolar
sin reglas de convivencia.

**Las fotos quedan afuera.** El formulario de aviso de hoy no las pide, y una
cola que arrastra archivos es otro tamaño de problema.

## La decisión que gobierna todo: el número no se inventa

Las dos rutas de alta —`POST /api/mantenimiento/avisos` y
`POST /api/mantenimiento/ordenes`— sacan el número **de la planilla**, y
escriben la fila **antes** de tocar la base. Está comentado en las dos y el
porqué está medido: el 16/10/2026 la OT 2796 quedó en la base con un número que
la hoja de respuestas todavía no había repartido, y la sincronización la habría
pisado con la del formulario. «La planilla manda» es lo que hace que el número
signifique algo.

Sin señal no hay planilla, así que **no hay número**. Preguntado si eso
importaba, la respuesta fue que no: «el número no me importa, lo cargo y
listo».

De ahí sale la forma del diseño, y es la más conservadora posible:

> **La cola guarda el cuerpo del formulario y después llama a la misma ruta de
> hoy.** No hay numeración local, no hay un número provisorio que después se
> cambia, no hay una segunda forma de crear una OT. La carga queda esperando
> entera y se ejecuta tarde, contra el mismo código que corre cuando hay señal.

Es lo que evita la clase de error de la que este repo ya tiene cicatrices: dos
caminos de alta que se van separando, y el de abajo haciendo algo que el de
arriba no sabe.

## Cómo abre la app sin señal

Acá está la decisión más grande, y **es mía**: hay dos formas de que la app
abra sin señal y la barata es también la más robusta.

**Lo que NO se hace: poner offline las dos pantallas de hoy.**
`app/(app)/mantenimiento/avisos/page.tsx` y `.../ordenes/page.tsx` son
componentes de servidor que consultan Supabase, y
`app/(app)/layout.tsx` pregunta quién sos y manda a `/login` en cada render. Que
eso funcione sin conexión significa cachear cargas útiles del router de Next y
un armazón que no redirija — frágil, difícil de probar, y además un service
worker ya registrado **sigue sirviendo hasta que se actualiza**, así que
equivocarse ahí no se arregla con un deploy.

**Lo que sí se hace: una pantalla propia para cargar, que funciona siempre.**
Una ruta nueva —`/mantenimiento/cargar`— que se dibuja **entera en el
navegador**, sin pedirle nada al servidor para mostrarse, y que tiene los dos
formularios: aviso y OT. El service worker la guarda completa. Con señal anda
igual que todo lo demás; sin señal es lo único que anda, y alcanza.

Y el service worker **la usa de respaldo para cualquier navegación que falle
por falta de conexión**. O sea: abrís el SdG en la planta, no hay señal, y en
vez de la pantalla de error del navegador aparece el SdG diciendo que estás sin
conexión y ofreciendo cargar un aviso o una OT. Ese es el momento del pedido,
resuelto de punta a punta.

Las pantallas de hoy no se tocan. Siguen siendo las de siempre, con señal.

### Lo que esa pantalla necesita guardado

Los desplegables. Medido el 18/10/2026 contra producción:

| | |
|---|---|
| equipos activos | 244 filas, 34 KB |
| sectores | 40 filas, 5,6 KB |
| operarios | 10 filas, 1,2 KB |

**41 KB en total**, y es exactamente lo que piden los dos formularios: el de
aviso pide equipos y sectores a `/api/mantenimiento/equipos-y-sectores`, y el de
OT recibe esos dos y pide los operarios a `/api/mantenimiento/operarios`. Es
chico, cambia poco y no es secreto para quien ya tiene acceso al módulo. Se
refresca cuando hay señal.

**Lo que no se hace acá es la fase 3 entera.** No se cachean listados, ni el
tablero, ni el historial. Sólo esta pantalla y estas tres listas. La fase 3
sigue pendiente y con su propio spec.

### Quién la cargó

La pantalla offline se dibuja sin preguntarle a nadie quién sos, así que el
teléfono tiene que **recordar a quién le pertenece la carga**: cada una queda
atada al usuario que estaba logueado cuando se escribió.

No es paranoia: `IndexedDB` es del navegador, no de la persona, y el alta de OT
escribe en la planilla el **nombre y el correo de la sesión**. Si un teléfono
pasa de mano, una carga que se vacía bajo otra sesión aparece firmada por quien
no la hizo — y eso no se nota nunca, que es la peor clase de error de este
sistema. **Una carga no se manda bajo una sesión distinta de la que la
escribió**: espera, y la pantalla de la cola dice de quién es.

## La fecha es la del momento en que se cargó

Un aviso cargado el viernes en la planta que recién entra el lunes **dice
viernes**. Se preguntó y se decidió así: la planilla es de donde sale el
historial del equipo y el MTBF, y un aviso fechado tres días tarde es un dato
falso, no un detalle cosmético.

Eso tiene un precio concreto: **la ruta del aviso hoy no acepta una fecha**, la
pone ella con `hoyEnArgentina()`. Hay que dejar que la acepte del cuerpo. Es un
ensanche chico y real de «la misma ruta de hoy», y se anota como tal. La ruta de
la OT ya acepta `fecha`; lo que no acepta es el `creado` que
`altaEnLaPlanilla()` estampa con la hora del envío.

## Los dos fracasos, que son distintos

### 1. Se mandó y la ruta la rechazó

El servidor **sí se enteró**: la carga le llegó y él la devolvió. Se le avisa a
la persona con el motivo que devolvió la ruta **sin traducir** —es la regla de
los fallos de escritura de Sheets, y vale igual acá: un diagnóstico que no se
distingue de otro no es un diagnóstico—.

Y una distinción que hay que hacer bien, porque equivocarse acá **pierde la
carga**:

| | |
|---|---|
| **Definitivo** | `400` (falta la descripción), `403` (sin permiso de edición). Reintentar no va a cambiar nada. Se avisa y la carga queda parada, visible y editable, no borrada |

> **«Editable», resuelto el 19/10/2026.** La primera versión dejaba la carga
> parada con dos botones —«Reintentar igual», que manda otra vez exactamente lo
> que ya fue rechazado, y «Borrar», que pierde lo escrito—. O sea que ante un
> 400 las dos salidas eran inútiles, y una OT son dieciocho campos cargados
> parado en la cantera. Ahora hay un tercer botón, **«Corregir y volver a
> mandar»**: vuelve los valores al formulario y la carga vieja sale de la cola
> **recién cuando la corregida está guardada** —antes, cerrar la pantalla a
> mitad de camino la habría perdido—. La corregida lleva **clave nueva**: es
> otro cuerpo, y la vieja puede haber quedado reservada del lado del servidor,
> así que reusarla recibiría un 409 «en duda» que no es cierto. Se ofrece sólo
> sobre las **paradas propias**: una que espera puede estar saliendo en este
> mismo momento, y una ajena no se corrige en nombre de otro.
| **Pasajero** | `401` (la sesión se venció mientras esperaba), `502` (Google caído, que es como la ruta reporta que no pudo escribir la planilla), o que el `fetch` ni salga. Se reintenta más tarde |

**Un `401` tratado como definitivo tira a la basura una carga perfectamente
buena**, y es el caso más probable de todos: la sesión de Supabase se vence
sola, y una carga que esperó un día la va a encontrar vencida.

**Con señal, en cambio, nada de esto se activa.** Un `502` con la app conectada
sigue siendo lo que es hoy: un error a la vista, con la persona ahí para
reintentarlo. Absorberlo en la cola sería convertir un fallo visible en uno
silencioso, que es exactamente lo que este sistema trata de no hacer.

### 2. Nunca se mandó

Acá el servidor **no sabe que existe**. La carga está en ese teléfono y en
ningún otro lado: ni en Supabase, ni en la planilla. Por eso el SdG **no puede
avisar de esto por ningún medio propio** — no se puede avisar de algo que no se
sabe que existe. Es una limitación de física, no una decisión.

El tope acordado es **un día**: más que eso ya es un problema. Algo tiene que
despertar al teléfono dentro de ese plazo, y son tres cosas, de más a menos
confiable:

1. **Abrir la app.** Siempre funciona. Al abrir se vacía la cola.
2. **Android, con la app cerrada**: el navegador tiene un mecanismo de
   sincronización en segundo plano que dispara al volver la conexión.
3. **iPhone, con la app cerrada**: no existe nada parecido, **pero cuando llega
   una notificación push el sistema despierta al service worker**. O sea que el
   resumen diario de las 8:30 —que ya anda desde la fase 2— puede ser el latido
   que vacía la cola.

**El punto 3 es un plan, no un hecho.** Hay que probarlo en un iPhone de verdad
antes de contar con él, con el mismo estándar con el que se probó el push de la
fase 2: no alcanza con que el estándar lo permita. Y tiene dos agujeros propios
que hay que decir en vez de descubrir:

- **Depende de tener las notificaciones prendidas en ese teléfono.**
- **El resumen diario no se manda cuando no hay nada para mirar**, por decisión
  de la fase 2. Un día tranquilo no hay latido.

**Si la prueba en el iPhone sale mal, la fase sale igual** y en iPhone el
vaciado queda siendo sólo «al abrir la app». En ese caso el aviso de abajo deja
de ser una red y pasa a ser el mecanismo principal, y hay que hacerlo más
fuerte.

La red de abajo, en todos los casos: **al abrir la app, el SdG dice que había
algo esperando desde ayer** — tarde, pero nunca silencioso.

## El correo queda para después, y eso tiene una consecuencia

Se pidió que un fallo avisara por notificación **y por correo**. El correo
**no entra en esta fase**: hoy el SdG no puede mandar ninguno —lo único que sale
son los links de acceso, y los manda Supabase Auth con sus plantillas— y
habilitarlo necesita un paso humano fuera del repo. Se decidió no bloquear la
fase por eso.

Cuando se haga, la forma propuesta es un **Apps Script** en el Google de la
empresa llamado por el SdG con un secreto compartido: el patrón que ya existe en
Facturación con la casilla de facturas (`FACTURACION_CORREO_SECRET`), sin sumar
proveedores ni cuentas que pagar. **Va a quien hizo la carga**, nadie más.

**La consecuencia, dicha derecho:** sin correo, el único aviso de que una carga
falló es la notificación push, y **las notificaciones las tiene prendidas una
sola persona de trece**. Para los otros doce, enterarse va a significar abrir el
SdG y mirar la pantalla de la cola. Mientras el correo no exista, que la gente
prenda las notificaciones **es parte de que esto funcione**, no una preferencia.

> **Medido el 19/10/2026**, contra producción con el `SUPABASE_SERVICE_ROLE_KEY`
> y de sólo lectura: `push_suscripciones` tiene **una fila**, de **un** usuario,
> contra **trece** usuarios activos. Este número vale, y durante la ejecución se
> escribió «dos de trece» en cuatro archivos —`public/sw.js` dos veces,
> `lib/core/vaciarLaCola.ts` y `components/CargasEsperando.tsx`— justificando
> con él decisiones de diseño. Era falso y ya está corregido. Se anota acá
> porque el número va a volver a cambiar: el que no lleva fecha no se puede
> revisar.

## Mandar dos veces es peor que no mandar

El caso que no estaba en el pedido y que va a pasar: **señal mala no es lo mismo
que sin señal**. El pedido sale, el servidor lo procesa, escribe la fila en la
planilla, y la respuesta se pierde en el camino. Para el teléfono eso es
indistinguible de un fracaso, así que reintenta — y queda **una segunda OT, con
un segundo número**, por un trabajo que es uno solo. Ensucia la planilla, que es
la fuente de verdad del módulo, de una forma que nadie va a poder reconstruir
después.

**Cada carga lleva una clave propia, generada en el teléfono, y la ruta la usa
para no hacer dos veces lo mismo.** Es una decisión mía, no pedida: sin ella la
cola anda casi siempre y el resto de las veces hace daño permanente.

**Esa clave necesita una tabla propia, y por lo tanto una migración aplicada a
mano antes de empezar.** No alcanza con una columna en `avisos` o en las
órdenes, y el motivo es preciso: existe una ventana en la que **la fila ya se
escribió en la planilla y el insert en la base falló** —la ruta de OT la
contempla y devuelve 500 pidiendo que no se reintente—. En esa ventana no hay
ninguna fila donde haber guardado la clave, así que un reintento escribiría una
segunda fila y consumiría un segundo número. La clave tiene que quedar
registrada **antes** de tocar la planilla, y eso es una tabla.

## Lo que la persona ve

Con señal, nada cambia: se carga desde las pantallas de siempre y dice «Se cargó
el aviso 1234», como hoy.

Sin señal, el formulario **acepta** la carga y dice con todas las letras que
queda para mandarse, sin número. Lo que no puede pasar es que parezca que se
cargó.

Y tiene que haber **un lugar donde se vea qué está esperando** —cuántas, de
cuándo, cuál falló y por qué, y de quién es cada una—, con la posibilidad de
reintentar a mano una que quedó parada. Esa pantalla es, mientras no haya
correo, el único lugar donde doce de trece personas se van a poder enterar de
que algo salió mal.

## Objetivos, no-objetivos, y lo que sería un fracaso

**Objetivos**

- Que el SdG abra en la planta sin señal y deje cargar un aviso o una OT.
- Que esas cargas lleguen solas cuando vuelve la señal.
- Que ninguna carga desaparezca callada.
- Que una carga no espere más de un día sin que alguien se entere.

**No-objetivos**

- La fase 3 (leer sin señal) más allá de la pantalla de carga y los tres
  catálogos.
- Encolar cualquier otra cosa: stock, compras, producción, fotos.
- El correo (queda para después, con su consecuencia escrita arriba).
- Que funcione con la app desinstalada o en una pestaña común de Safari. En
  iPhone todo esto depende de que esté agregada a la pantalla de inicio, igual
  que el push de la fase 2.

**Anti-objetivos** — esto sería un fracaso aunque funcione

- **Un número de aviso o de OT inventado en el teléfono.** Rompe lo único que
  hace que el número signifique algo.
- **Una carga que se pierde sin que nadie se entere.** Es peor que no tener
  cola: hoy el formulario falla a la vista y la persona lo sabe.
- **Una OT duplicada en la planilla.** Ensucia la fuente de verdad de forma
  irreversible.
- **Una carga firmada por quien no la hizo**, porque el teléfono cambió de mano.
- **Un service worker que rompa lo que hoy anda.** Las descargas de Excel y el
  canje del `?code=` de los correos están excluidos a propósito en `public/sw.js`
  y ahí explicado por qué. Esta fase agranda ese archivo: que nadie saque esas
  exclusiones de paso.

## Lo que queda a cargo de quien lo construya

- **Dónde vive la cola.** Tiene que ser **IndexedDB** y eso no es preferencia:
  `localStorage` no se puede leer desde un service worker, y es el service
  worker quien tiene que vaciarla con la app cerrada. Lo que queda abierto es la
  forma de los registros.
- **La forma de la clave contra duplicados** y cómo la usan las dos rutas, dado
  que se registra antes de tocar la planilla.
- **Qué dispara el vaciado y en qué orden** (al abrir, al volver la conexión, en
  el `sync` de Android, en el `push` de iPhone), y que dos disparos simultáneos
  no manden lo mismo dos veces.
- **La política de reintento** de los fallos pasajeros: cada cuánto y hasta
  cuándo, antes de pasar a avisar.
- **Dónde se ve la cola**: dentro de la pantalla de carga, o aparte.
- **Si la pantalla de carga reemplaza a los dos modales de hoy o convive con
  ellos.** Conviene mirarlo: dos formularios para lo mismo es la clase de cosa
  que después se va separando.
- **Cómo se prueba.** Lo que no se puede dar por bueno razonando: que la app
  abra sin señal en un iPhone real y en un Android real, el vaciado desde el
  service worker, y el duplicado por respuesta perdida. La lógica pura —qué es
  definitivo y qué es pasajero, el orden de la cola, la clave, a quién pertenece
  cada carga— va con tests de vitest, que es donde este repo pone las
  decisiones.

## Lo que hay que pedir antes de empezar

- **La migración de la tabla de claves**, aplicada a mano en el editor SQL de
  Supabase. Sin eso no se puede escribir la parte que evita el duplicado, y es
  la única dependencia con tiempo de espera de toda la fase.

## Lo que se decidió que NO hace falta

- **No lleva registro en `auditoria`.** Crear un aviso o una OT no es una acción
  irreversible —no está auditada hoy, con señal— y una carga que llega de la
  cola no es más irreversible por haber esperado. Lo que el anti-objetivo pide
  es que la cola **se pueda mirar**, y eso lo da la pantalla. Así se evita un
  verbo nuevo y otra migración.
