# Mensajería interna

Acordado el 11 de noviembre de 2026. El pedido fue «agregar a todo el sistema
una mensajería interna», **con el criterio a mi cargo**: no hubo preguntas, así
que todo lo que sigue son decisiones mías y están marcadas como tales.

## Lo primero, porque cambia el diseño entero

Antes de decidir nada medí quién usa el SdG. Son cuatro números y los cuatro
empujan en la misma dirección:

| | |
|---|---|
| Usuarios activos | **14**, y los 14 tienen correo cargado |
| Con notificaciones push | **1 persona, 1 aparato** |
| Personas que alguna vez **escribieron** algo | **6 de 14**, sobre 21 tablas con columna de autor |
| Las notas de una OT —lo más parecido a mensajería que ya existe— | **18 notas, escritas por una sola persona**; la última el 06/11/2026 |

Y el reparto de esas 6: Bernardo 805 filas, Delfina 164, Rocco 115, Mayra 91,
Luna 15, Nicolás 2.

**Un chat necesita dos personas y acá la mitad del padrón nunca escribió una
fila.** Eso no dice que la mensajería no sirva —escribir no es leer, y puede
ser justamente lo que traiga a los otros ocho—, pero sí dice que un diseño que
dé por sentado que alguien contesta del otro lado va a fallar callado.

Lo que sí es una conclusión firme: **hoy el único canal que llega a los catorce
es el correo.** El push llega a una persona, un mes después de que existe.

## Qué es, y qué no

**No es un chat.** WhatsApp ya existe, ya lo usan y gana: es más rápido, está
en el teléfono de todos y no pide entrar a ningún lado. Construir un chat
adentro del SdG es pelear esa pelea y perderla, y además el día que se pierda
quedan las conversaciones partidas en dos lugares.

**Lo que el SdG puede hacer y WhatsApp no es que lo hablado quede pegado a la
cosa.** Un mensaje sobre la OT 2983 vive en la OT 2983: lo ve quien la abra hoy
y quien la abra en seis meses, sin tener que haber estado en el grupo correcto
el día correcto. Eso es lo que se construye.

La unidad es **un hilo colgado de un registro**: una orden de trabajo, un
requerimiento de compra, una condición insegura, una muestra del laboratorio.

## Cómo se engancha a «todo el sistema»

**El hilo apunta a su registro por `(tipo, id)` y sin foreign key.** Es
deliberado y tiene precedente en esta casa: `cargas_offline.entidad_id` lo hace
igual, con el comentario «sin foreign key a propósito: apunta a una u otra
tabla según `tipo`», y `auditoria` también.

El costo, dicho: **nadie garantiza que ese id exista**. Si alguien borra una OT
—y las sincronizaciones borran de verdad desde el 18/10/2026— su hilo queda
colgando. La alternativa era una tabla de hilos por módulo, que multiplica por
doce el código y hace que «todo el sistema» no sea verdad nunca. Se elige el
huérfano y se lo trata: la pantalla del hilo dice «este registro ya no está»
en vez de romper.

**Transversal desde el día uno, enganchado de a una pantalla.** El mecanismo no
pertenece a ningún módulo —vive en `lib/core` y `app/api/mensajes`, como
`auditoria`—, y sumar una pantalla nueva es declarar un tipo y poner el
componente. Las tres primeras son las que ya tienen forma de «alguien está
esperando»: la OT, el requerimiento de compra y la condición insegura.

## Cómo llega, y acá está la inversión

**Por correo, no por push.** Es lo contrario de lo que hace el resto del
sistema hoy, y el motivo es el número de arriba: el push llega a 1 de 14 y el
correo a 14 de 14. Un mensaje interno que no le llega a nadie no es una
mensajería, es un cuaderno.

Se usa el camino que ya existe y ya está probado contra el script real:
`lib/core/correo.ts` y el Apps Script de `docs/sdg-correo-apps-script.gs`
—medido el 20/10/2026: 1.918 ms en frío—. **No hace falta nada nuevo del lado
de Google.**

**El push no se toca.** No se agrega un quinto emisor instantáneo: el portón de
`lib/core/avisoAlInstante.ts` pide tres condiciones y un mensaje de una persona
a otra no cumple la segunda —nada se frena hasta que conteste—. La Agenda ya
entró cumpliendo dos de tres y su propio encabezado dice que es «un precedente
y no un permiso»; esto no lo usa de excusa.

## A quién le llega: mencionar

**Un mensaje sin mención es una nota en el registro. Un mensaje con `@` le
llega a esa persona.** Esto es una decisión mía y es la que más me importa.

El camino fácil era avisarle a «todo el que vea el módulo». Está medido lo que
pasa así: `compras-por-aprobar` le llegaba a 6 personas de las cuales 3 no
podían aprobar, y de las dos únicas personas que probaron las notificaciones en
serio, **las dos tenían los 13 avisos descartados**. Un aviso que no es para
vos te enseña a ignorar todos.

Entonces: quien escribe elige a quién le llega. Si no elige a nadie, el mensaje
queda igual —pegado al registro, visible para quien lo abra— pero no interrumpe
a nadie.

**Sólo se puede mencionar a quien pueda ver el registro, y la lista lo dice.**
Es la consecuencia incómoda de la regla de permisos de abajo y conviene decirla
acá: el correo lleva el texto del mensaje, así que mandárselo a alguien sin el
módulo le filtra por correo lo que el sistema le tapa, y además el enlace lo
rebota al inicio. Un mensaje que llega y cuyo hilo no se puede abrir es
exactamente el anti-objetivo: alguien escribió creyendo que avisó.

El costo, medido y dicho: **6 de 14 no pueden ver una OT**, y `mis-avisos`
existe justamente porque «quien ve una máquina rota trabaja en Producción, en
Cantera o en el laboratorio, y de 14 usuarios 10 no tienen el módulo». O sea
que **quien reportó el problema es, típicamente, a quien no se va a poder
mencionar en la OT**. Eso no se resuelve agrandando la lista: se resuelve
enganchando el hilo al **aviso**, que el que reportó sí ve. Queda anotado como
el cuarto tipo y no entra ahora.

## Quién puede ver un hilo, y quién puede escribir en él

**El que puede ver el registro. Las dos cosas.** No hay un permiso nuevo.

Es la única regla que no se desincroniza: cualquier otra cosa —una lista de
participantes, un permiso propio— es un segundo lugar donde decidir quién ve
qué, y este repo ya tiene medido lo que cuesta eso (105 rutas con el cliente
admin donde el permiso lo pone la ruta y no RLS).

**Que ver y escribir sean lo mismo es una decisión mía y va contra el
precedente que tiene al lado**, así que la escribo con su motivo.
`ordenes_trabajo_notas` se lee con `mant_puede_ver()` y se escribe con
`mant_puede_editar()`, que son dos conjuntos distintos: medido hoy, una OT la
ven 8 personas y la pueden editar 5; una condición insegura la ven 4 y la
pueden editar 3. Copiar ese molde haría que en Seguridad e Higiene puedan
escribir **tres personas, y las tres están entre las seis que ya escriben
todo**: la mensajería nacería sin poder traer a nadie nuevo, que es
exactamente lo único que el último párrafo de este documento se propone medir
a los dos meses.

La diferencia que lo justifica: una **nota** es parte del trabajo —dice «por
qué esta OT no se hizo» y sale exportada en la columna X de la planilla—, así
que quien la escribe está editando la orden. Un **mensaje** es una
conversación, y una conversación donde sólo hablan los que editan no es una
conversación, es un comunicado.

**Qué cuenta como «puede ver el registro» no es siempre el módulo.** Para la
OT es `mant_puede_ver()` y para la condición insegura `tiene_acceso_syh()`,
pero `compras_requerimientos` tiene la policy de SELECT en `true` a propósito
desde la migración 018 —«el circuito de compras es transversal a toda la
empresa»—, así que un requerimiento **lo ven los catorce** aunque el módulo
Compras lo tengan ocho. El hilo sigue al registro y no al módulo: un hilo de
requerimiento es la única cosa del sistema que leen y escriben los catorce, y
por eso el componente va también en `/mis-pedidos` y no sólo en la pantalla
del módulo.

## Si el registro ya no está, el hilo queda

Y queda **visible para los mismos que podían ver registros de ese tipo**. Las
otras dos salidas son peores: dejarlo sólo para quien participó inventa la
lista de participantes que esta sección acaba de descartar, y dejarlo sólo
para `admin_sistema` lo entierra, que es el anti-objetivo de la conversación
que nadie vuelve a abrir. El borrado de espejo **no se lleva el hilo**: lo que
se habló sobre una OT es justamente lo que queda cuando la OT se fue.

Consecuencia que hay que decir en voz alta: **no hay mensajes privados.** Si
una conversación no puede ser vista por todo el que ve esa OT, no va acá. Eso
es una limitación a propósito y conviene que esté escrita en la pantalla, no
sólo en este documento.

## No se edita ni se borra

El historial es la señal: editar un mensaje después de que alguien lo leyó, o
borrarlo, convierte el hilo en algo que no se puede usar como respaldo de nada.

**Acá tampoco se copia a las notas de la OT, al revés de lo que decía la
primera versión de este documento.** Esa migración sí tiene policy de delete
sobre la propia nota, y lo deja escrito: «un error se arregla borrando la
propia nota». Un mensaje no puede: ya salió un correo con el texto adentro y
eso no se desmanda. Borrarlo dejaría a la otra persona con un texto en la
casilla que en el sistema no existe, que es peor que un error visible.

Lo que sí hay es **marcar como leído**, que es de cada uno y no cambia el hilo.

## El correo es de ida

Va a pasar que alguien conteste el correo, porque es el reflejo obvio, y esa
respuesta cae en la casilla personal de quien administra el SdG y se pierde —
que es la «conversación partida en dos lugares» con la que este documento
descartó el chat. Por ahora **el cuerpo lo dice**: no se responde ahí, se
contesta en el SdG.

Pero el asunto lleva el identificador del hilo **desde el día uno**, que no
cuesta nada y es lo único que después no se puede agregar hacia atrás. Si
alguna vez se quiere leer la respuesta, el camino existe: la facturación ya
mete correo entrante al SdG por el mismo mecanismo
(`docs/facturacion-correo-apps-script.gs`).

## Convive con las notas de la OT, no las reemplaza

`ordenes_trabajo_notas` **se queda como está.** Tiene un significado propio
—«por qué esta OT todavía no se hizo»—, alimenta la **columna X** de la
planilla con la última, y la usa alguien todas las semanas. Tragarla dentro de
un mensaje genérico rompería la exportación y perdería la distinción entre una
justificación y un comentario.

En la pantalla de la OT van a verse las dos cosas, y el documento del módulo
tiene que decir cuál es cuál.

## Objetivos, no-objetivos, anti-objetivos

**Objetivos**

- Que lo que se habla sobre un registro quede con el registro.
- Que quien tiene que enterarse se entere, por un canal que hoy le llega.
- Que sumar la mensajería a una pantalla nueva cueste una línea.

**No-objetivos**

- Competir con WhatsApp para la conversación del día.
- Mensajes privados entre dos personas.
- Un quinto emisor de push.
- Mensajería sin señal. La cola offline es de Mantenimiento y de dos
  formularios; meter mensajes ahí es otro proyecto.

**Anti-objetivos** — sería un fracaso aunque funcione

- **Que alguien escriba un mensaje creyendo que le llegó a otro y no le haya
  llegado.** Es el peor: la pantalla tiene que decir a quién le va a llegar
  **antes** de mandar, no después.
- **Que se vuelva un quinto motivo para apagar las notificaciones.**
- **Que una conversación quede en un hilo que nadie vuelve a abrir**, porque el
  registro se borró y el hilo quedó huérfano en silencio.
- Que empuje a la gente a escribir cosas privadas en un lugar que no lo es.

## Lo que queda a cargo de quien lo construya

- **La forma de la tabla**: un hilo con sus mensajes, o mensajes sueltos con
  `(tipo, id)` repetido. Con el volumen de este sistema las dos andan.
- **Cómo se elige a quién mencionar.** Tiene que usar `components/Select.tsx`
  y no un parser de texto que busque `@`. Lo que ya no queda abierto es de
  dónde sale la lista: **la gente que puede ver ese registro**, que es menos
  que los catorce y depende del tipo.
- **Cada cuánto sale el correo**: uno por mensaje, o uno juntando los de un
  rato. Con el volumen de hoy uno por mensaje alcanza; si alguna vez molesta,
  la salida ya está escrita en el spec de los avisos al instante.
- **Dónde se ven los míos.** Hay dos pantallas transversales que ya resuelven
  esto para otra cosa, «Mis avisos» y «Mis pedidos», y conviene mirarlas antes
  de inventar una tercera forma.
- **Qué se prueba con vitest**: a quién le llega un mensaje, qué pasa con un
  registro borrado, y que un hilo no se vea sin permiso del registro. Las
  pantallas y las rutas no tienen tests en este repo.

## El día que el correo no esté configurado, hay que decirlo

`enviarCorreo()` devuelve `"sin-configurar"` **en silencio y sin loguear** si
faltan `SDG_CORREO_URL` o `SDG_CORREO_SECRET`, y hoy su único llamador es el
rechazo de una carga sin señal, que casi no corre: nadie se enteraría. Con una
mensajería encima, eso es el anti-objetivo número uno multiplicado por cada
mensaje.

Entonces: **si el correo no está configurado, la pantalla lo dice antes de
escribir** —la mención queda deshabilitada con el motivo a la vista— y el
mensaje se guarda igual. Un cuaderno honesto es mejor que una mensajería que
miente.

## Lo que te toca a vos

**Una migración**, aplicada a mano en el editor SQL de Supabase. Es la única
dependencia con tiempo de espera, así que se pide antes de empezar.

Y **confirmar que `SDG_CORREO_URL` y `SDG_CORREO_SECRET` están en el proyecto
`sistema-integral` de Vercel**, no sólo en `.env.local`. Es lo único de todo
este diseño que no puedo ver desde acá, y de ello depende que el día uno salga
un correo o cero. Lo que sí está medido y da bien: **los 14 usuarios activos
tienen correo cargado y los 14 son @polcecal.com**, así que el filtro de
dominios del Apps Script no es un problema.

Y una decisión que no es técnica y que no puedo tomar yo: **si la mensajería
tiene que existir sabiendo que hoy escriben 6 de 14.** Puede ser exactamente lo
que falta para que entren los otros ocho, o puede ser una pantalla más que mira
una sola persona, como las notas de la OT. Lo que sí se puede hacer es
mirarlo: a los dos meses, contar cuántas personas distintas escribieron un
mensaje. Si es una, el diagnóstico no era éste.

## Cómo terminó

Construido el 11 y 12 de noviembre de 2026, en diecisiete commits. La migración
`20261111110717_mensajes_pegados_a_su_registro.sql` está **aplicada**. Lo que
sigue no es el resumen de lo que se hizo —eso lo cuenta el código— sino las
cuatro cosas que costaron y que el próximo no tiene por qué volver a descubrir.

**El bug que ningún test de este repo puede atrapar, y que casi se entrega.**
`mensajes` llega a `usuarios` por dos caminos —el `creado_por` y el
muchos-a-muchos que crea `mensajes_menciones`—, así que `autor:usuarios(...)`
es ambiguo y PostgREST contesta **300 `PGRST201`**. La feature se fabricó su
propia ambigüedad al agregar la tabla de menciones: por eso
`ordenes_trabajo_notas`, con el mismo embebido, sigue andando. Lo que lo vuelve
grave no es la consulta sino el reparto: **el `POST` funciona igual**, porque su
`select()` no embebe nada. O sea que alguien escribía, mencionaba, **el correo
salía**, y después el hilo no se podía abrir ni por el autor ni por el
mencionado — el anti-objetivo número uno en su forma literal. Los 6045 tests
estaban en verde: las cadenas de `select()` no las mira nadie. Apareció recién
al correr las consultas contra la base, y la defensa es que **las dos cadenas
de esta familia llevan el FK explícito** (`usuarios!mensajes_creado_por_fkey`).
El `usuario:usuarios(...)` anidado dentro de `menciones:` no lo lleva ni lo
necesita: desde ahí hay un solo camino.

**RLS sabía más de lo que el plan creía.** El plan decía que quien decide si
alguien ve un hilo es la ruta «porque RLS no lo sabe», y es falso para dos de
los tres tipos: `mant_puede_ver()` y `tiene_acceso_syh()` dependen del usuario
y no del registro. Con la lectura abierta, cualquiera con su token leía por
PostgREST los hilos de Mantenimiento y de Seguridad e Higiene que su rol no ve,
incluido `aviso_fallo`. Se cerró con un `case entidad_tipo` antes de aplicar la
migración. De ahí sale la regla que hay que sostener: **`ENTIDADES[tipo].puedeVerlo`
tiene que espejar la policy de SELECT de la tabla destino**, y nada lo comprueba.

**Un enlace que funciona para ocho no funciona.** El correo de un requerimiento
apuntaba a la pantalla del módulo Compras, que redirige a quien no lo tiene —
justo las seis personas por las que el hilo se montó en Mis pedidos. Ahora
apunta a `/mis-pedidos?pedido=<id>`, que alcanzan los catorce, y el costo
asumido es que quien **sí** tiene Compras cae ahí y no en el detalle del
módulo. La condición insegura tuvo el mismo problema y la misma solución
(`?condicion=<id>`). **La orden de trabajo sigue sin resolverlo**: su enlace
lleva a la lista filtrada por `?q=<número>` y no a la orden, porque
Mantenimiento no tiene página por orden y hacerla pide diseño, no un parámetro.
Es el único de los tres que todavía depende de que quien lee busque.

**Lo que se decidió y no se hizo**, para que no se lea como un olvido: el
`aviso_fallo` lo puede leer por PostgREST cualquiera que vea el hilo, y taparlo
sólo en la pantalla es una cortesía y no una frontera —cerrarlo de verdad pide
`grant` por columna—; y una caída de la base averiguando el permiso de una OT
sale como **403 y no como 503**, porque `nivelMantenimientoDe` descarta el
`error` de sus lecturas. Arreglar eso es tocar otro módulo con tráfico, así que
quedó dicho en los docstrings en vez de hecho a medias.

### Lo que sólo se puede comprobar en la primera corrida real

Nada se probó con datos: las dos tablas están vacías y lo medido son consultas
que resuelven, no un hilo que se lee. En orden:

1. **Que `SDG_CORREO_URL` y `SDG_CORREO_SECRET` estén en el proyecto
   `sistema-integral` de Vercel.** Si faltan, la pantalla lo dice —la mención
   queda deshabilitada con el motivo— pero **no sale ni un correo**, y como no
   hay contador de menciones sin leer en el menú ni en la campana (deliberado:
   el canal es el correo), la mensajería queda muda sin que nadie se entere.
   Lo contesta `correo_configurado` de `/api/mensajes/destinatarios`.
2. **Que `NEXT_PUBLIC_APP_URL` esté puesta allá.** En local no se nota, porque
   la url base cae al `host`; lo que se ve es un correo con el dominio
   equivocado.
3. **Leer un hilo antes que escribir uno.** Es el orden que habría encontrado
   el `PGRST201` el primer día en vez del último.
4. **Mencionar a alguien sin el módulo** y confirmar que no se lo puede ni
   elegir, y **escribir con alguien que ve Seguridad e Higiene pero no la
   edita**, que tiene que poder: es la decisión que se tomó contra el
   precedente de las notas de la OT.
5. **Que un correo deje `avisado_en` escrito.** Si queda en null con el
   `aviso_fallo` también vacío, el `after()` no llegó a correr y la mención va a
   decir «pendiente» para siempre.

### Lo que quedó anotado y no se arregló

Una docena de cosas menores, ninguna bloqueante, triadas por la revisión final:
el cartel de «esto no es privado» desaparece en el hilo huérfano; el `PATCH`
marca todas las menciones del hilo y no sólo las que la tarjeta mostraba; la
concordancia en singular del aviso de mencionados ausentes; `creado_por` sin
`on delete`, que ahora pide su propia migración. El detalle vivía en el registro
de ejecución, que se borró al cerrar: lo que de verdad importaba está arriba.
