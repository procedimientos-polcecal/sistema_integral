# Mantenimiento — cerrar una OT antes de su fecha de inicio, diciendo por qué

**Fecha:** 12/11/2026
**Estado:** acordado, sin empezar

---

## Qué se pide, y qué parte ya existe

Que se pueda poner una fecha de cierre anterior a la fecha de inicio de la OT, y
que cuando eso pase el sistema **exija una justificación**.

La primera mitad ya está: **hoy no hay ninguna regla que lo frene**, en ningún
lado. `loQueSeContradice` de [lib/mantenimiento/altaDeOT.ts](../../../lib/mantenimiento/altaDeOT.ts)
compara la fecha de fin estimada contra la de inicio y dice en su propio
comentario que no mira la de cierre; el `PATCH` de
`app/api/mantenimiento/ordenes/route.ts` —por donde entra «Registrar el
trabajo»— no valida fechas en absoluto. Una OT programada para el 20/11 se
cierra hoy con fecha del 05/11 y entra sin una palabra.

Así que lo que hay para construir es **la segunda mitad**: que esa fecha siga
entrando, y que no entre muda.

## Por qué, con el caso que lo pidió

Una OT programada dice cuándo se va a empezar. El equipo se rompe antes, se
interviene, y el trabajo queda hecho con fecha anterior a la que el papel decía
que iba a arrancar. No es un error de tipeo: es información. Lo que hoy se
pierde es el porqué, y lo busca Mantenimiento meses después, cuando mira una OT
cuyo cierre es anterior a su inicio y no tiene de dónde deducir si fue un
adelanto real o un dedo equivocado.

## Lo que se midió antes de decidir

Contra la base de producción, el 12/11/2026, sobre las 2.442 OT:

| | |
|---|---|
| OT con fecha de inicio **y** de cierre | 2.176 |
| Con el cierre **anterior** al inicio | **66** |
| Con el cierre el mismo día | 1.768 |
| Con cierre y sin inicio | 0 |

De esas 66:

- **44 son PROGRAMADO y 22 CORRECTIVO.** O sea que el caso más frecuente no es
  el que motivó el pedido: es trabajo programado hecho un poco antes. El
  correctivo adelantado es un tercio. Las 66 están en `REALIZADO`.
- **El adelanto típico es de 2 días** y 57 de 66 caen dentro de la semana. Hay
  cinco de más de un mes y una de 3.652 días, que es un error de carga evidente.
- **Sólo 3 de las 66 entraron por la app.** Las otras 63 vinieron del formulario
  o de la planilla.

Ese último número es el que ordena las expectativas y por eso está acá: esta
regla alcanza a una porción chica de lo que ya pasó. No la vuelve inútil —las
tres de la app son de octubre y noviembre, y cada vez se carga más desde el
sistema—, pero sí obliga a decir con todas las letras que **lo que entra por la
planilla va a seguir cerrándose antes sin explicar nada**, y que nadie se va a
enterar.

Se midió con un script de lectura que no quedó en el repo; se rehace con una
consulta a `ordenes_trabajo` sobre `fecha_ejecucion` y `fecha_cierre`.

## La decisión que se tomó sobre el umbral

**Se pide siempre.** Cualquier cierre anterior al inicio pide justificación,
aunque sea por un día.

Se discutió el riesgo y se asumió a conciencia: con la mediana en 2 días, la
pantalla va a pedir explicación en el caso más común, y lo que se escriba
cincuenta veces puede terminar siendo «se hizo antes». Una justificación que
todos escriben igual se deja de leer. Se eligió igual la regla sin umbral
porque un umbral es un número que hay que justificar, que nadie recuerda, y que
deja un tramo donde el dato se pierde en silencio — que es exactamente lo que
esto viene a cerrar. **Si aparece el ruido, lo que se revisa es el umbral, no
la regla**: ése es el lugar donde volver.

Contra el ruido juega una cosa medida: el validador que se va a usar no acepta
cualquier cosa.

## Intención

Que ninguna OT quede con el cierre antes del inicio sin que alguien haya dicho
por qué, en los lugares donde esa fecha la pone una persona dentro del sistema.

## Objetivos

- La fecha sigue entrando. **Esto no bloquea nada**: pide un dato más.
- La justificación se exige en los **tres** lugares donde una persona carga la
  fecha de cierre, y la misma regla corre en el servidor y en el formulario.
- Se lee donde Mantenimiento la busca: **en las observaciones de la OT**.
- Queda en el sistema, no sólo en la planilla.

## No objetivos

- **No se tocan las 66 que ya existen.** No hay justificación que inventarles, y
  dejarlas en null dice la verdad: nadie la escribió.
- **No se exige a lo que entra por la planilla ni al formulario de Google.** No
  se puede: ahí no hay dónde preguntar. Es la misma línea que ya tiene la fecha
  de fin, obligatoria sólo donde completa una persona en el sistema.
- **No se exige a los cuatro generadores automáticos** —los periódicos, el
  cuaderno de contratista, los partes de contratista y los grupos del cuaderno—.
  Ninguno pasa por `loQueFaltaParaCrear`, por el mismo motivo por el que no se
  cayeron cuando la fecha de fin se volvió obligatoria.
- **No se audita.** La tabla `auditoria` es para lo que no se deshace; esto es
  un texto que se puede corregir.
- No se agrega ninguna columna a la planilla.

## Anti-objetivos

Lo que haría fracasar esto aunque funcione:

- **Que la justificación sea un trámite.** Si «x», «ok» o un punto alcanzan, lo
  único que se logró es una pantalla más lenta. Por eso se usa el validador que
  ya existe y no un `.trim()`.
- **Que trabe la corrección de una OT vieja.** Si para arreglarle las horas a
  una de las 66 hay que inventar una justificación, la regla se convierte en un
  obstáculo y lo que va a aparecer es «se hizo antes» escrito a desgano.
- **Que el texto quede sólo en un lugar que alguien puede pisar sin que el
  sistema se entere.**

## Las decisiones de forma, como se decidieron

### 1. Columna propia en `ordenes_trabajo`

`cierre_justificacion text`, en el prefijo de su campo como ya hacen
`gut_*` y `falla_*`.

Se eligió contra la alternativa de que viviera sólo en la planilla. Con columna:
se ve en la ficha de la OT, se puede contar después, y sobrevive a que alguien
edite la celda. Sin columna, **hoy no se vería desde el sistema en absoluto**:
las observaciones de una OT no son una columna de `ordenes_trabajo` —viven en la
columna W del master y en `mantenimientos_ejecuciones.observations`— y el
detalle de la OT en pantalla no las muestra.

Cuesta una migración, que **la corre una persona a mano** en el editor SQL de
Supabase. Hasta que esté aplicada, nada de esto se puede desplegar.

### 2. Campo propio en pantalla, que aparece sólo cuando hace falta

No se reutiliza el textarea de observaciones de «Registrar el trabajo». Dos
razones: ahí se cuenta **qué se encontró al hacer el trabajo**, que es otra
pregunta; y las dos altas no tienen ese textarea, así que un campo condicional
es menos pantalla nueva que agregarles un campo de observaciones general.

El campo aparece en el momento en que las dos fechas lo piden, y desaparece si
se corrige la fecha.

### 3. Va a las observaciones de la OT, con un prefijo fijo

A la columna W del master, con `Cerrada antes del inicio: ` delante. El prefijo
es el mismo recurso que ya usa `observacionDeLaDesestimacion` de
[lib/mantenimiento/desestimarAviso.ts](../../../lib/mantenimiento/desestimarAviso.ts),
y por el mismo motivo escrito allá: que se reconozca de un vistazo entre las
observaciones que alguien escribe a mano.

Cuando hay las dos cosas —justificación y observaciones del trabajo— la celda
las lleva juntas, la justificación primero.

**Y la celda se compone desde la fila, no desde el cuerpo del pedido.** Es la
diferencia que evita el peor final de todo esto. `RegistrarOTModal` manda
`observaciones` en **cada** guardado, también vacío, así que la W se reescribe
cada vez que se registra el trabajo. Si el texto se armara con lo que vino en el
cuerpo, el segundo registro de una OT —uno que ya no dispara la regla— le
borraría de la W el renglón «Cerrada antes del inicio: …» sin que nadie se
entere, que es el tercer anti-objetivo. Se arma entonces con la justificación
**que quedó en la columna** más las observaciones de este pedido. La ruta ya
tiene las dos cosas a mano: lee la fila antes del `update` para saber la fecha
de inicio, y el `update` le devuelve la orden como quedó.

**Por qué la W y no la X**, que es la otra columna de texto libre que esta
planilla tiene. La X es la observación previa —«por qué esta OT todavía no se
hizo»—, la escriben las notas de `ordenes_trabajo_notas` y su bloque en pantalla
sólo aparece en las OT que **no** están realizadas. Técnicamente sería más
cómoda: no la comparte nadie más, y el costo que se acepta más abajo —que el
drenaje de la cola se lleve la parte de las observaciones— existe justamente
porque la W es compartida. Se eligió la W igual, y por una razón que no es
técnica: **es donde Mantenimiento la busca**. Poner el dato donde el código lo
tiene más fácil y no donde lo lee la gente es cómo un dato queda escrito y sin
leer.

### 4. El validador es el del núcleo, no un `.trim()`

`justificacionQueExplica()` de [lib/core/justificacion.ts](../../../lib/core/justificacion.ts),
el mismo que usan Compras para denegar un requerimiento y Mantenimiento para
denegar una orden de servicio. Rechaza «no», «x», «prueba», «n/a» y lo que no
tenga ninguna letra; acepta «Duplicado», que son nueve letras y es un motivo
completo. Lo que filtra no es la longitud sino la no-respuesta.

Esto es lo único que hoy se opone al anti-objetivo del trámite, y por eso no se
reemplaza por una comprobación más barata.

## Dónde muerde la regla, y dónde no

La fecha de cierre la pone una persona en **tres** lugares, y conviene saber
cuál es cuál porque no se parecen:

| Dónde | Qué es | Tiene observaciones |
|---|---|---|
| `RegistrarOTModal` | cierra una OT que ya existe — **el caso que motivó el pedido** | sí |
| `NuevaOTModal` | alta de una OT que nace cerrada | no |
| `FormularioOTOffline` | la misma alta, cargada sin señal | no |

Las dos altas comparten camino: las dos llaman a `loQueFaltaParaCrear`, igual
que el `POST` de la ruta, así que **la regla puesta ahí las cubre a las tres
puntas de una vez** —el formulario y el servidor ven lo mismo, que es la razón
por la que esa función existe—.

`GenerarOTModal` (desde un aviso) y `GenerarOTDeMantenimiento` también llaman a
`loQueFaltaParaCrear`, pero **no tienen campo de fecha de cierre**: la regla
queda inerte ahí y no hay nada que hacer.

«Registrar el trabajo» entra por el `PATCH`, que **no pasa por
`loQueFaltaParaCrear`**. Ahí la comprobación hay que ponerla a mano, y tiene una
dificultad propia que se describe abajo.

## Las trampas, que es lo que no se deduce del código

### El `PATCH` no sabe la fecha de inicio, y el modal tampoco

El cuerpo que manda «Registrar el trabajo» lleva la fecha de cierre y no la de
inicio, porque esa no se está cambiando. O sea que la ruta **tiene que leer
`fecha_ejecucion` de la orden antes de decidir**, y hacerlo antes del `update`:
después ya escribió.

Y del lado de la pantalla, `RegistrarOTModal` **no recibe hoy `fecha_ejecucion`
en sus props**. Hay que agregarla, y declararla obligatoria y no opcional, por
el mismo argumento que ya está escrito en ese archivo para la falla: si el
listado dejara de traerla, el campo no aparecería nunca y nadie se enteraría.

### La regla se dispara por el valor, no por la clave — y «Registrar» siempre manda la clave

El `PATCH` exige la justificación **cuando la fecha de cierre que llega es
distinta de la que la orden ya tenía**, incluido el caso de que no tuviera
ninguna.

La distinción no es un detalle: **`RegistrarOTModal` manda `fecha_cierre` en
todos los guardados**, así que «vino la clave en el cuerpo» sería siempre cierto
y la regla preguntaría también a quien sólo está corrigiendo las horas. Eso es
el anti-objetivo de trabar la corrección de una OT vieja. Comparar contra el
valor guardado no cuesta una lectura de más: la ruta ya tiene que leer la fila
para saber la fecha de inicio.

**Y de ahí sale un arreglo que hay que hacer, porque si no lo de arriba no es
cierto.** Hoy el campo de fecha de ese modal arranca en **hoy** y no en la fecha
de cierre que la orden ya tiene (el `hoy()` de `RegistrarOTModal`). O sea que
reabrir una OT cerrada para corregirle las horas **le mueve la fecha de cierre
al día de hoy**, en silencio, y eso ya pasa hoy sin que esta regla exista. Con
la comparación contra el guardado, además, esa corrección contaría como un
cambio de fecha y dispararía la pregunta. Se arregla precargando el campo con la
fecha de cierre guardada cuando la hay, y dejando el `hoy()` para las que no
están cerradas.

Es un cambio de comportamiento en una pantalla que nadie pidió cambiar, y va
igual: sin él, «no traba la corrección de una OT vieja» es una frase que el
código no sostiene. Queda escrito acá para que se pueda discutir.

Con esto, la primera vez que alguien vuelva a cerrar una de las 66 con una fecha
distinta sí se le va a pedir la justificación — y eso está bien, porque en ese
momento está volviendo a decir cuándo se cerró.

### Si las fechas dejan de contradecirse, el texto se borra

Alguien corrige la fecha de cierre y la deja después del inicio, o corre la de
inicio, o en el alta escribe la justificación y después arregla la fecha y el
campo desaparece. En todos esos casos **la columna se vacía**.

Dejarla llena sería peor que no tenerla: la ficha y la columna W seguirían
diciendo «Cerrada antes del inicio» de una orden cuyo cierre ya no es anterior,
nadie volvería a mirarla, y lo que queda es una afirmación falsa con cara de
dato. Es la misma decisión —y el mismo argumento— que ya está escrita en
`celdaDeObservacionPrevia` de [lib/mantenimiento/notas.ts](../../../lib/mantenimiento/notas.ts):
cuando se borra la única nota, la celda se vacía, porque «dejar la anterior
sería mentir sobre por qué está parada».

Lo que cuesta, dicho: el sistema borra un texto que escribió una persona. Se
acepta porque sólo pasa cuando esa misma persona cambió la fecha que lo hacía
necesario, y porque la alternativa es mentir.

### Una carga sin señal vieja vuelve sin la clave

Un teléfono que encoló una OT antes de que el campo existiera manda un cuerpo
sin `cierre_justificacion`. Si esa OT trae el cierre adelantado, **tiene que
recibir un 400 que la nombre**, no pasar de largo: es exactamente lo que se
decidió cuando la fecha de fin se volvió obligatoria, y está escrito en el
docstring de `fecha_fin` en `altaDeOT.ts`.

Eso no deja a nadie colgado, y vale saberlo antes de preocuparse: un 400 vuelve
a la carga encolada como `rechazada`, y `app/cargar/CargarClient.tsx` deja
abrirla, completarla y mandarla de nuevo. La carga no se pierde: queda parada
pidiendo el dato.

De ahí sale una consecuencia para el tipo: **la clave va obligatoria en la
interfaz aunque el valor pueda faltar.** El día que la fecha de fin se volvió
obligatoria, la ruta del alta armaba el objeto sin nombrarla, la regla la vio
`undefined` y habría rechazado todas las órdenes del sistema sin que `tsc`
dijera nada. Exigir la clave y permitir el valor vacío deja que el compilador
nombre a quien se olvide.

### La cola rearma el registro desde la fila, y eso cambia qué puede pisar

Ésta es la trampa que más cuesta ver, y conviene leerla entera antes de tocar la
exportación.

`sheets_pendiente` no es sólo una cola de reintentos: es lo único que evita que
la sincronización pise lo que cargó el sistema. Y **no guarda el registro: lo
vuelve a armar desde la fila** con `loQueHayQueExportar`. Hoy las observaciones
no están ahí —no tienen columna— y por eso un fallo que sólo las afecte no se
encola: se avisa en pantalla y listo. El porqué completo está en
[lib/mantenimiento/pendienteDeLaOT.ts](../../../lib/mantenimiento/pendienteDeLaOT.ts).

La justificación **sí va a tener columna**, así que sí se puede rearmar, y por
lo tanto **sí entra a `loQueHayQueExportar`**. Hace falta que entre: en el alta,
la fila del master llega por `IMPORTRANGE` y tarda, así que la primera escritura
falla casi siempre —medido en este repo: las cinco órdenes del 18/10/2026
fallaron a los 0,6 segundos, y 48 de 48 OT del cuaderno quedaron con sus
columnas vacías—. Si la justificación no entrara a la cola, **en el alta no
llegaría nunca a la planilla.**

Lo que eso cuesta, dicho: cuando la cola drena, arma la celda W **con la
justificación sola**, porque las observaciones no se pueden rearmar. Si esa OT
ya tenía las dos cosas en la W, el drenaje se lleva la parte de las
observaciones. No se pierde el dato —las observaciones de «Registrar el
trabajo» quedan en `mantenimientos_ejecuciones.observations`, y las altas no
tienen observaciones— pero sí se pierde esa copia en la planilla. Es el lado
barato de equivocarse y se acepta a conciencia; la alternativa era que la
justificación del alta no saliera nunca.

### Lo que la planilla no va a poder decir

La W es una columna escribible del master, no derrame, así que alguien puede
corregirla a mano. **El sistema no la relee** —la sincronización no importa la
W—, así que una corrección escrita allá no vuelve, y la próxima escritura la
pisa. Es el comportamiento que ya tienen las observaciones; se nombra acá para
que no sorprenda.

## Lo que queda para quien lo construya

- Dónde vive la función pura. La sugerencia es un archivo propio en
  `lib/mantenimiento/`, que exporte la pregunta («¿el cierre es anterior al
  inicio?») separada de la exigencia, porque la pantalla necesita la primera
  para mostrar el campo y la regla necesita la segunda. Con sus tests.
- El rótulo del campo en pantalla y el texto de ayuda.
- Si la justificación se muestra en el detalle de la OT como un renglón más
  —el `GET` hace `select("*")`, así que la columna llega sola— o con algún
  destaque. Se construye: que se vea es la mitad del punto de tenerla en una
  columna. **No se hace editable desde ahí** en este cambio: se corrige
  volviendo a registrar el trabajo, que es donde se corrige todo lo demás.
- El texto exacto del mensaje, dentro de la forma que se decide abajo.

### De qué forma sale el mensaje, que ya está decidida

El pedido de la justificación **entra a la lista de `loQueFaltaParaCrear`**, con
los demás faltantes, y sale en el mismo `Falta cargar …` de siempre: «por qué se
cerró antes de la fecha de inicio». Todo junto y no de a uno, que es la vara de
`validar()` del núcleo.

Lo que **no** hace, aunque el borrador de este documento lo pedía, es nombrar
las dos fechas. Ése es el recurso de `loQueSeContradice`, que es otra cosa: una
contradicción entre dos datos cargados, donde hay que decir contra qué está mal
el que está mal, y que además sale por un camino distinto —un segundo chequeo
que sólo corre en el servidor y que las dos altas no ejecutan del lado del
navegador—. Acá no hay nada que no se esté viendo: el campo aparece debajo de
las mismas dos fechas que lo provocaron. Meterlo en la lista de faltantes
cuesta un renglón; mezclar las dos formas obligaría a cambiar cómo arman el
mensaje los tres formularios.

### Y el chequeo del lado del navegador va antes de todo lo demás

En «Registrar el trabajo» el modal guarda **primero la ejecución y después la
OT**, así que un rechazo del servidor deja el trabajo registrado y la orden sin
cerrar. La comprobación del formulario va en el mismo lugar donde ya está la de
las observaciones de un trabajo parcial o cancelado: al principio de `guardar()`,
antes de que se postee nada.

## Cómo se comprueba

Lo de siempre, y dos que importan especialmente acá:

```bash
npm test
npx tsc --noEmit
npm run build
node scripts/revisar-exportaciones.mjs
node scripts/revisar-responsive.mjs
node scripts/revisar-arbol-commiteado.mjs
```

`revisar-exportaciones` porque esto toca una escritura a la planilla, y
`revisar-responsive` porque se agregan campos a tres formularios y el SdG se usa
desde el teléfono: el ancho útil es 343 px.

Y lo que ningún script puede comprobar: **la migración la corre el usuario a
mano**. Hasta que esté aplicada, la columna no existe y la ruta devuelve el 400
de PostgREST que corta el insert entero — el mismo que dio `estado_raw` el
29/10/2026. El orden es: migración primero, despliegue después.
