# El correo de la carga que no entró

Acordado el 19 de octubre de 2026. Es la pieza que quedó explícitamente afuera
de la [fase 4](2026-10-18-mantenimiento-cargar-sin-senal-design.md), donde se
pidió avisar «con una notificación **y un mail**» y el mail se difirió porque el
SdG no podía mandar ninguno.

## El momento que esto resuelve

Cargaste un aviso en la planta, sin señal. El teléfono lo guardó. Cuando volvió
la conexión lo mandó, y la ruta lo rechazó: faltaba la descripción, o la fecha
no servía, o no tenés permiso de edición en Mantenimiento. Vos ya te fuiste de
la planta convencido de que lo cargaste.

Hoy eso te lo dice la pantalla `/cargar` si entrás a mirar, y el push si lo
tenés prendido. El correo es para que te enteres **sin tener que mirar**.

## Lo que es, y sobre todo lo que no es

**Es sólo para esto**, preguntado y confirmado: un correo a **quien hizo la
carga**, cuando una carga que **estuvo esperando** fue rechazada de forma
definitiva.

**No es un canal de correo para el sistema.** No manda el resumen diario, no
reemplaza al push, no le llega a nadie más. La tentación existe y está medida:
al 19/10/2026 las notificaciones las tiene **una sola persona de trece**, así
que un correo general le llegaría a los doce que el push no alcanza. Se
preguntó explícitamente y la respuesta fue que no: esto es para la carga que no
entró. Si algún día se quiere lo otro, el mecanismo va a estar, pero la decisión
es otra y se toma aparte.

## Quién lo manda, y cuándo

**La ruta, en el momento de rechazar.** Cuando llega una carga con su `clave` y
la respuesta es definitiva, ahí mismo sale el correo. No hace falta que el
teléfono avise nada ni un endpoint nuevo: el servidor ya tiene el rechazo en la
mano, y sabe de quién es la sesión.

Definitivo quiere decir lo mismo que para la cola —`clasificarFallo` en
`public/cola/colaOffline.js`—: los `400`, `403` y `409` que la ruta devuelve
**con su `error` adentro**. Un `502` de Google o un `401` no son definitivos, se
reintentan solos, y no mandan nada.

### Cómo sabe que la persona no estaba mirando

**La carga viaja diciendo de dónde salió**, y el correo sale **sólo cuando la
mandó el teléfono solo, con la app cerrada**.

La primera versión de este documento cortaba por tiempo: cuánto había pasado
desde que la carga se guardó en la cola. Una revisión mostró que eso no evita el
correo de más, lo **garantiza**. Para doce de trece personas el único disparo
real es abrir la app —sin el push no hay latido, y el `sync` no existe en
iPhone—, así que la carga del viernes se manda el lunes cuando la persona abre
el SdG, la rechazan, y el correo sale mientras la barra y `/cargar` le están
diciendo exactamente lo mismo. El caso más frecuente sería el redundante, que es
cómo se enseña a ignorar los correos del sistema.

El dato existe y hoy no viaja: `public/sw.js` sabe perfectamente quién lo
despertó —un `message` de la pestaña, o un `push`/`sync`— porque son tres
handlers distintos. Hay que llevarlo hasta la ruta:

| De dónde salió | ¿Estaba mirando? | ¿Correo? |
|---|---|---|
| `message` de la pantalla, o el envío directo del formulario | sí | no |
| `push` o `sync`, con la app cerrada | no | **sí** |

Eso toca el cuerpo que se manda, las funciones de la cola y el service worker, y
por eso se decide ahora y no después.

**Y hace innecesario el corte por tiempo.** Con esto no hay que comparar relojes,
así que se caen también los dos cuidados que pedía un reloj mal puesto. Es menos
código y una regla más fácil de explicar: si la app estaba cerrada, no estabas
mirando.

**Si el dato no viene, no se manda.** Un cuerpo sin esa marca es uno que no pasó
por la cola —el formulario con señal, o algo armado a mano—, y ésos nunca
mandaron correo.

## Qué dice

Corto, y con el motivo real sin traducir, que es la regla de este repo para
cualquier fallo de escritura:

> **No se pudo cargar el aviso que hiciste el viernes**
> «Bomba 3 pierde aceite» — Taller
> El sistema dijo: *Contá qué pasa.*
> Quedó guardado en tu teléfono, en Cargar. Corregilo y mandalo de nuevo.

### Y un segundo texto, para el caso dudoso

Hay un rechazo que no es como los otros: el **«en duda»**, que la ruta devuelve
con un 409 cuando la clave quedó reservada y **no se sabe si la fila llegó a
escribirse en la planilla**. Ése avisa también, y con **su propio texto**,
porque el del ejemplo sería mentira: quizás sí se cargó.

Es el aviso más caro de perderse. Es justamente el caso que, si nadie lo mira,
termina en una OT duplicada en la fuente de verdad del módulo — que es el
anti-objetivo de la fase 4 entera. Tiene que decir que hay que **mirar la
planilla antes de cargarla de nuevo**, que es lo mismo que ya dice la ruta en
pantalla.

Son dos textos, entonces, y no uno. Lo que comparten: qué carga era y dónde
está.

Lo que no puede faltar en los dos: **qué carga era** —lo suficiente para reconocerla entre
varias—, **el motivo textual que devolvió la ruta**, y **dónde está ahora**, que
es la pantalla de carga de ese teléfono y de ningún otro.

Lo que no lleva: ningún enlace que prometa abrir esa carga. La carga vive en el
IndexedDB de **ese** teléfono; un enlace abriría `/cargar` en el aparato donde
se lea el correo, que puede ser la computadora, y ahí no está. Decir dónde está
es verdad; linkear a donde no está, no.

## Lo que no puede hacer

**Si la carga nunca salió del teléfono, nadie puede avisar por correo.** El
servidor no sabe que existe: no está en Supabase, no está en la planilla, está
en ese aparato y en ningún lado más. Es la misma limitación de física que ya
está escrita en la fase 4, y no la levanta este trabajo. Para ese caso la única
red sigue siendo la barra al abrir la app.

Conviene que quede dicho porque es el malentendido fácil: este correo cubre
«se mandó y lo rechazaron», no «nunca se mandó».

## Cómo se manda

**Un Apps Script en el Google de la empresa, llamado por el SdG con un secreto
compartido.** Es el patrón que ya usan seis scripts de este repo, y evita sumar
un proveedor de correo y una cuenta que pagar.

**Con una diferencia que hay que decir: va en la dirección contraria a los que
existen.** `docs/facturacion-correo-apps-script.gs` es Apps Script **llamando
al** SdG; éste es el SdG **llamando a** un Apps Script publicado como aplicación
web. Eso trae sus propias cosas:

- La aplicación web se publica **ejecutándose como el dueño** y accesible por
  URL. Lo único que la protege es el secreto, así que **el script rechaza todo
  pedido que no lo traiga**, antes de mirar nada más.
- **El script sólo manda a direcciones del dominio de la empresa.** Sin eso, una
  URL filtrada es un relay abierto para mandar correo desde la empresa. Es la
  única protección que no se puede delegar en el secreto.
- `MailApp` tiene cupo diario. Con el volumen de esto —una carga rechazada es
  un hecho raro— no se toca, pero el script tiene que fallar diciendo qué pasó
  y no en silencio.

**Sale de la cuenta de quien administra el SdG**, y eso se decidió sobre la
marcha, el 20/10/2026, cambiando lo que decía antes este documento. El plan era
una casilla del sistema, para que el correo no figure mandado por una persona.
Se descartó por una razón práctica: **Vercel no da casillas** —no tiene producto
de correo—, así que una casilla aparte es un usuario más de Google Workspace, o
sea una licencia, para mandar un correo que hoy es raro.

Lo que hizo aceptable la decisión es que **es reversible y barata de revertir**:
renombrar esa cuenta más adelante no rompe nada, porque un renombre en Workspace
deja la misma cuenta, el mismo Drive y el mismo proyecto, así que la URL de
implementación sigue sirviendo. Lo que sí rompe es **mover el proyecto a otra
cuenta**: hay que transferirlo antes de suspender la vieja y volver a publicar.

Y si algún día molesta que el remitente sea una persona sin querer pagar una
licencia, la salida es un **alias de envío** en esa misma cuenta con el
remitente fijo en las propiedades del script. **Fijo, nunca tomado del pedido**:
hoy `MailApp.sendEmail` se llama con tres argumentos sueltos justamente para que
desde el cuerpo no se pueda inyectar `from`, `cc` ni copia oculta, y eso no se
negocia por comodidad.

El porqué de no leer ni escribir Gmail desde el servidor ya está medido y
escrito en el encabezado de `docs/facturacion-correo-apps-script.gs`: la cuenta
de servicio pide un token haciéndose pasar por un usuario y Google contesta
`unauthorized_client`, porque la delegación a nivel dominio no está otorgada —y
otorgarla le daría al sistema permiso de leer **cualquier** buzón.

## La regla que no se puede romper

**Que el correo no salga no puede hacer fallar nada.** Es la misma regla que ya
gobierna el registro de la clave en esas dos rutas, y por el mismo motivo: la
respuesta que la ruta le debe a la persona es sobre su carga, no sobre el
correo. Un fallo al mandar se atrapa, se cuenta en la respuesta como los otros
—`planilla_error`, `aviso_error`, `clave_error` ya están— y no cambia el estado
de nada.

Y al revés: **sin el Apps Script configurado, todo tiene que seguir andando
exactamente como hoy.** Entre el deploy de esto y el día que alguien publique el
script va a pasar tiempo, igual que con las migraciones. Sin la variable, no se
intenta mandar y no se rompe nada.

## Objetivos, no-objetivos, y lo que sería un fracaso

**Objetivos**

- Que quien cargó algo en la planta se entere de que no entró, sin tener que
  mirar.
- Que el motivo que lea sea el de verdad, sin traducir.

**No-objetivos**

- Mandar cualquier otro correo del sistema.
- Avisarle a nadie más que a quien hizo la carga.
- Cubrir la carga que nunca salió del teléfono.
- Reemplazar al push ni a la barra.

**Anti-objetivos** — esto sería un fracaso aunque funcione

- **Que un fallo del correo voltee una carga que sí entró.**
- **Un correo por cada intento.** Una carga rechazada manda uno, no uno por
  reintento; si no, se silencia el remitente y a partir de ahí no avisa más
  nada, que es la misma trampa que la fase 2 evitó con el resumen diario.
- **Un relay abierto**: que la URL del script sirva para mandar correo desde la
  empresa a cualquier lado.
- **Un correo que diga algo que no es verdad**, como prometer un enlace a una
  carga que vive en otro aparato.

## Lo que queda a cargo de quien lo construya

- **Dónde vive el envío.** Hoy no hay ningún módulo de correo; lo lógico es uno
  del núcleo, al lado de `lib/core/webpush.ts`, con la misma forma: una función
  que devuelve qué pasó en vez de lanzar.
- **El corte de «esperó»**, su nombre y su valor.
- **Cómo se evita el correo repetido** si la misma carga se reintenta a mano y
  vuelve a dar el mismo 400. La fila de `cargas_offline` ya existe y es el lugar
  natural para anotarlo, pero puede necesitar una columna —y entonces hay que
  pedir la migración antes de empezar, porque la aplica una persona.
- **El texto exacto**, respetando lo que tiene que llevar.
- **Qué se prueba con vitest**: la decisión de mandar o no mandar —esperó o no,
  definitivo o no, reloj raro— es pura y va probada. El envío en sí es una
  llamada HTTP y no se mockea, igual que `enviarPush`.

## Dos decisiones mías, para que las puedas rechazar

**No se guarda en ninguna parte qué correo ya se mandó, y por lo tanto no hace
falta ninguna migración.** La duda era el correo repetido si la misma carga se
reintenta y vuelve a dar el mismo rechazo. Con la regla de arriba se disuelve:
un rechazo definitivo deja la carga **parada**, y una carga parada no la vuelve
a tomar ningún disparo automático — el único que puede reintentarla es una
persona apretando «Mandar ahora», y eso es la pantalla, o sea primer plano, o
sea **sin correo**. El otro camino que se evaluó era reservar la clave antes de
validar, para tener dónde anotarlo, y se descarta: daría vuelta un orden que
está documentado con su porqué y convertiría un 400 honesto en un 409 que manda
a mirar una planilla donde no hay nada.

**Que el correo no salga se registra en el servidor y no se le dice a nadie, y
es una excepción deliberada a una regla de este repo.** La regla —un fallo de
escritura nunca es un `console.warn`— existe porque una escritura que no llega a
la planilla crea una divergencia que no avisa. Acá no hay divergencia: la carga
sigue parada, visible en `/cargar` y contada por la barra. Un correo que no sale
degrada al estado anterior a este trabajo, nada más. Y decírselo a alguien en la
respuesta sería inútil, porque por diseño **no hay nadie mirando** cuando esto
pasa: la respuesta se la lleva el service worker. Lo que sí hay que hacer es que
la llamada al Apps Script **no demore el rechazo**: va con un tope de espera
corto, porque del otro lado hay un servicio que no es rápido.

## Lo que te toca a vos

1. **Publicar el Apps Script** en el Google de la empresa, como aplicación web.
2. **Poner su URL y su secreto** en Vercel y en `.env.local`, y documentarlos en
   [docs/VARIABLES-VERCEL.md](../../VARIABLES-VERCEL.md).
3. Si hace falta una columna en `cargas_offline`, **aplicar esa migración a
   mano**.

Hasta que eso esté, el SdG sigue andando igual y no manda ningún correo.

## Cómo terminó (20/10/2026)

**El código está hecho y en `main`, y el camino hasta el Apps Script está
probado contra el script real.** El Apps Script lo publicó una persona desde su
cuenta ese día, y las dos variables quedaron puestas.

Lo medido llamando a `enviarCorreo` de verdad:

| | |
|---|---|
| Primer envío, **en frío** | `enviado` en 1.918 ms |
| Segundo, en caliente | `enviado` en 1.773 ms |
| A una dirección de otro dominio | `fallo`, con `dominio-no-permitido` |

**Y los dos correos llegaron de verdad**, confirmado por quien los recibió. No
es un detalle: `enviado` es lo que contestó el Apps Script, y eso prueba que el
pedido salió, no que el correo haya aterrizado en una casilla. Es la misma
distinción que este repo paga cada vez que la olvida — verificar el gesto en
lugar del resultado.

Tres cosas que eso deja fijadas y que antes eran supuestos:

- **El tope de espera de 5 s es generoso**, no apretado. Era el único número de
  todo este trabajo puesto a ojo, y la duda era al revés: que un arranque en
  frío de Apps Script se lo comiera.
- **El script no es un relay abierto.** La dirección de otro dominio se rechaza
  del lado de Google, no del lado del SdG.
- **Apps Script contesta 200 aunque rechace**, con `ok:false` en el cuerpo. Lo
  había encontrado la revisión final leyendo el código; acá quedó visto. Si el
  módulo mirara `respuesta.ok`, ese rechazo habría pasado por enviado.

### Lo que falta, y es lo mismo que le falta a la fase 4

El camino entero en un teléfono: cargar algo sin señal, cerrar la app, dejar que
el teléfono lo mande solo, y ver si llega el correo. Y la otra mitad, que es la
que define el diseño: **mandando desde la pantalla no tiene que llegar nada**.

Eso no se puede probar hasta que se corra la verificación en aparatos de la fase
4, porque depende de las mismas dos cosas: que `/cargar` abra sin señal y que el
service worker despierte con la app cerrada.
