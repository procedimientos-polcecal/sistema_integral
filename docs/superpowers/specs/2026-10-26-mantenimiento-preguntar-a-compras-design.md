# Preguntarle a Compras por un repuesto, sin salir de la OT

**Acordado el 26/10/2026.** Diseño; todavía no hay plan ni código.

## El problema

Una orden de trabajo queda parada porque falta un repuesto. Quien la tiene que
hacer anota el repuesto en «Repuestos que hacen falta» y ahí se termina: **no
tiene dónde preguntar qué pasa con ese pedido, y Compras no tiene dónde
contestar.**

Lo que falta no es el aviso, es **la vuelta**. Un push que diga «falta un
rodamiento» avisa una vez; el que preguntó sigue sin saber si el pedido existe,
si está demorado o si el proveedor no lo tiene. Y el que abre esa OT dos
semanas después no puede saber si alguien lo gestionó.

De ahí la frase que ordena todo el diseño, dicha por quien lo pidió: *«si
alguien mira la OT más tarde, tiene que saber si se gestionó o no»*.

## Qué se va a construir

Una conversación de dos partes —Mantenimiento pregunta, Compras contesta— que
**vive pegada a la orden de trabajo**, no en una bandeja aparte.

1. En «Repuestos que hacen falta», sobre una OT **por hacer o atrasada**, al
   lado de un repuesto sin stock aparece **«Preguntar a Compras»**.
2. Eso escribe una entrada en el historial de la OT, marcada como **pregunta**,
   y manda un push **en el momento** a quien contesta por los repuestos.
3. Esa persona **contesta desde Compras**, en una bandeja de preguntas
   abiertas, sin entrar a Mantenimiento.
4. La respuesta **se escribe en el historial de esa misma OT** y pasa a ser la
   justificación vigente de por qué sigue abierta — la que viaja a la planilla.
5. Una pregunta sin responder **se ve**: en la OT y en el resumen diario de
   quien tiene que contestarla.

## Por qué no es una mensajería interna

Así arrancó el pedido —*«tendríamos que construir una mensajería interna»*— y se
descartó en la conversación, por dos razones que conviene dejar escritas porque
la idea va a volver.

**La información tiene que quedar atada a la OT.** Una mensajería general pone
la conversación en una bandeja: se lee una vez, se archiva, y a los dos meses
nadie la encuentra desde la orden. Lo pedido es lo contrario — un historial
dentro de cada OT, *«como lo que tienen los equipos con el historial de
reparaciones»*.

**Y porque ese historial ya existe.** `lib/mantenimiento/notas.ts` arranca
diciendo literalmente *«Es un historial y no un campo»*: justificaciones que no
se editan ni se pisan, apiladas, en `ordenes_trabajo_notas`. Nació por una razón
que es casi este caso — *«una OT atrasada se vuelve a justificar con el tiempo
("falta el repuesto" → "esperamos la parada de planta"), y pisar la razón
anterior borra la única señal de que se viene postergando»*.

Construir una mensajería al lado sería **un segundo lugar donde la gente
escribe sobre la misma OT**, que es la clase de divergencia que este repo paga
caro. Lo que hay que hacer es que a ese historial puedan escribir dos.

## Lo que le falta al historial de hoy

Tres cosas, y son exactamente las tres que este diseño agrega:

| Hoy | Falta |
|---|---|
| Escribe uno solo: Mantenimiento justificándose. | Que Compras sea un participante. |
| Nadie se entera; se lee si alguien abre la OT. | Que la pregunta interrumpa a quien puede contestarla. |
| Todas las entradas son del mismo tipo. | Distinguir pregunta de respuesta, o «¿qué pasa con el rodamiento?» y «lo entrega el jueves» quedan como dos notas sueltas sin relación. |

## Las decisiones tomadas

### La respuesta de Compras **es** una justificación válida

Decidido explícitamente. «El proveedor lo entrega el jueves» es la razón por la
que esa OT sigue abierta, así que pasa a ser la justificación vigente y **viaja
a la columna X de la planilla** como cualquier otra — la celda tiene una sola
línea y recibe la última, que es lo que ya hace `notas.ts`.

Esto tiene una consecuencia que el constructor tiene que respetar: la ruta que
guarda la respuesta **tiene que exportar a la planilla**, con el mismo camino
que usa hoy la nota (`COLUMNA_OBSERVACION_PREVIA`, vía
`escribirEnLaFilaDeLaOT`). Es la regla de la casa: *toda ruta que toque un campo
que se exporta tiene que exportar, y si no puede, dejar el pendiente anotado*.

### Compras contesta desde Compras

**Quien compra no entra a Mantenimiento.** Pedirle que abra una OT para
contestar es pedirle que cambie de módulo para una tarea de treinta segundos, y
eso es exactamente lo que hace que la respuesta no llegue nunca.

Así que la respuesta se escribe desde una pantalla de Compras —«Preguntas de
Mantenimiento», con las abiertas— y **cae en el historial de la OT**. El dato
vive donde se consulta; la escritura ocurre donde está la persona.

### Quien contesta **no** necesita permiso de Mantenimiento

Hoy escribir una nota exige `puedeEditarMantenimiento` (ver el POST de
`app/api/mantenimiento/ordenes/[id]/notas/route.ts`). Un comprador no lo tiene.

Darle nivel de edición en Mantenimiento para que pueda contestar sería abrirle
toda la carga de órdenes para resolver un caso. La regla es más chica y más
precisa: **se puede responder si se tiene acceso a Compras y hay una pregunta
abierta dirigida a Compras en esa orden.** Fuera de eso, nada cambia.

### A quién le llega: una lista nueva, no `compras_aprobadores`

Quien lo pidió nombró una persona: **Facundo Ortiz** (`compras@polcecal.com`),
el encargado de compras.

Medido el 26/10/2026: Facundo **ya está** en `compras_aprobadores`, pero esa
lista tiene **cuatro** personas —él, Maximiliano Lenzetti, Nicolás Lenzetti y
Bernardo Strupp—. Mandar ahí la pregunta interrumpiría a tres que no son el
encargado.

Y el repo ya pagó este error por el otro lado, con número: *«`compras-por-aprobar`
va a `compras_aprobadores` y no a todo el que vea Compras: medido, le llegaba a
6 personas y 3 no podían aprobar»*. Reusar la lista de aprobar para preguntar
repite eso.

Va **una lista propia**, configurable desde Compras → Configuración igual que la
de aprobadores, que arranca con Facundo solo. **Lista y no persona fija**: una
licencia se arregla agregando a alguien en una pantalla, no editando código. Y
cuando esté vacía, la pregunta se puede escribir igual pero no interrumpe a
nadie — eso tiene que verse, no fallar en silencio.

### Quién puede preguntar: nivel de edición en Mantenimiento

Decidido. Preguntar escribe en el historial de la OT e interrumpe a una persona
nombrada, así que pide lo mismo que escribir una justificación hoy
(`puedeEditarMantenimiento`), y no lo que pide «Pedir a Compras», que no exige
nada.

Lo que cuesta, dicho: el técnico que abre la orden con permiso de sólo lectura
**ve** que falta la pieza y no puede preguntar — tiene que pedírselo a alguien
con edición. Se acepta a cambio de controlar quién interrumpe.

### Cuando Compras contesta, al que preguntó le llega un push

Decidido, y es la pieza más cara del diseño — pero menos de lo que parece.

**No puede usar `avisarAQuienDecide()`**: una respuesta no cumple la segunda
condición del aviso al instante —nada queda esperando una decisión del que
preguntó— y esa función está armada para listas de aprobadores, no para una
persona.

**Y tampoco hace falta el resumen diario**, que es por donde esto se habría
puesto caro: `avisosDeUsuario()` cuenta cosas globales y `avisos_fotos` guarda
una foto global, así que «mi pregunta fue respondida y no la leí» habría sido el
primer aviso con estado por persona del sistema, y habría roto el modelo de
movimiento-contra-stock del [spec del 18/10](2026-10-18-avisos-al-instante-design.md).

La salida es que **esto es un evento, no un conteo**: se manda una vez, a una
persona, en el momento en que contesta. Con eso no hace falta ni foto ni marca
de leído. Se arma con las piezas que ya están exportadas en
`lib/core/webpush.ts` y `lib/core/avisoAlInstante.ts`:
`aparatosAAvisar()` para los aparatos de esa persona, `esHoraDeAvisar()` para no
despertar a nadie a las tres de la mañana, y `enviarPush()` con el `Aviso` plano
de siempre —`{title, body, url}`, la url en el primer nivel— apuntando a la OT.

Si la persona que preguntó ya no tiene aparatos suscritos, no pasa nada: la
respuesta está en la OT igual. El envío va en un `try/catch` que no relanza,
como el resto: **un push que falla no puede voltear la respuesta que ya se
guardó**.

### Preguntar ya es explicar

Decidido: una pregunta cuenta como justificación. Saca el cartel «Sin
justificar» del listado y **viaja a la columna X de la planilla** como
cualquier nota.

Es coherente con lo que esas dos cosas significan —«¿por qué esta OT sigue
abierta?» «porque preguntamos a Compras por el repuesto y esperamos»— y con
cómo está escrito hoy: `app/api/mantenimiento/ordenes/justificadas/route.ts`
trata cualquier fila de `ordenes_trabajo_notas` como justificada, y
`celdaDeObservacionPrevia()` manda la última a la planilla. Si la pregunta vive
en esa tabla, esto pasa solo; lo que se decidió es **no** hacer la excepción
para que no pase.

Lo que cuesta, dicho: quien mira la planilla de afuera va a leer una pregunta
donde espera una razón. Se acepta porque «preguntamos y esperamos» *es* la
razón, y porque la alternativa —una OT con la pregunta hecha que igual aparece
«Sin justificar»— le pide a la gente que escriba dos veces lo mismo.

### El push pasa el filtro del aviso al instante, y hay que comprobarlo

`lib/core/avisoAlInstante.ts` deja escritas tres condiciones, y esto las cumple:

1. **Hay una persona nombrada esperando** — la lista nueva, no «el módulo».
2. **Nada avanza hasta que conteste** — la OT está parada por ese repuesto.
3. **Acaba de pasar** — alguien acaba de preguntar.

No se parece a «OT atrasadas», que el [spec de avisos al
instante](2026-10-18-avisos-al-instante-design.md) rechaza por ser *«un estado,
no un evento»*: acá el evento es la pregunta.

Se usa `avisarAQuienDecide()`, que ya trae la ventana 7:00–21:00, el
no-avisarle-a-quien-lo-hizo y una notificación por corrida. **Pero no tal
cual**, y conviene saberlo antes de estimar: su `textoDeLaInterrupcion()` tiene
escrito a mano «espera tu aprobación» / «esperan tu aprobación», que acá no
corresponde. Hay que parametrizar ese texto, y eso toca a los **dos emisores
que ya existen** y a sus tests. Además hay que sumar el nombre de la lista
nueva a `ListaDeAprobadores`.

### Una pregunta sin respuesta se ve

Es el estado que este diseño existe para hacer visible, así que no puede quedar
sólo en un push que se perdió:

- En la OT, la entrada dice **«preguntado hace N días, sin respuesta»**.
- Las que llevan mucho entran en el **resumen diario** de quien tiene que
  contestar, por `lib/home/avisos.ts`.

Ojo con la trampa que ese archivo documenta: **la campana muestra el stock y el
push el movimiento**, y un aviso nuevo sale por los dos lados. Un conteo nuevo
pide un id nuevo.

## Lo que queda afuera (no-objetivos)

- **No es una mensajería general.** No hay bandeja de entrada, ni mensajes entre
  dos personas cualesquiera, ni temas que no sean un repuesto de una OT.
- **No reemplaza al requerimiento.** Preguntar no crea un RI ni lo pide. Son dos
  cosas: el RI es el pedido, la pregunta es por el pedido. El botón «Pedir a
  Compras» sigue donde está.
- **No se audita.** `auditar()` es para lo irreversible del negocio; preguntar y
  contestar no cambian ningún dato que haya que reconstruir. Es la misma
  decisión que tomó el spec de avisos al instante.
- **No bloquea nada.** Ni la OT ni el pedido dependen de que alguien conteste.

## Lo que hay que saber antes de construirlo

**El anti-objetivo.** Que esto termine siendo un canal más que nadie mira. Si
las preguntas se acumulan sin respuesta y el aviso se vuelve ruido, es peor que
no tenerlo: agrega una ceremonia y no resuelve el caso. Por eso la lista chica,
por eso el seguimiento de las no respondidas, y por eso **no** se avisa a todo
el que tenga acceso a Compras.

**La pregunta nace de un repuesto concreto**, no de la OT en general. La entrada
tiene que decir cuál, porque una OT puede estar esperando dos cosas distintas de
dos pedidos distintos.

**Se pregunta sobre una OT por hacer o atrasada.** Es el pedido literal. Una OT
ya realizada no espera nada, y preguntar ahí es ruido. (`EN_PROCESO` queda
afuera por ahora: si en la práctica hace falta, se suma — es un valor en una
lista.)

**Esto se cruza con lo que se hizo el 26/10**: `lib/mantenimiento/riDelRepuesto.ts`
ya dice, al lado de cada repuesto sin stock, si **ya hay un RI en curso** por esa
pieza. Preguntar y «ya está pedido» conviven en la misma fila, y el constructor
tiene que resolver que no se pisen: lo más probable es que la pregunta tenga más
sentido **cuando ya hay un RI** —«está pedido, ¿y?»— que cuando no hay ninguno,
donde lo que corresponde es pedirlo.

## Lo decidido al escribir esto, que no salió de la conversación

Cuatro cosas que el revisor del documento marcó como huecos y que se cerraron
acá, porque un constructor sensato las resolvería igual. Van marcadas para que
se puedan discutir leyendo, sin volver a abrir el diseño entero.

- **La pregunta se escribe, no se genera.** Hay una caja de texto, validada como
  una nota (`validarNota`, `MAXIMO_DE_NOTA`, `textoParaLaCelda`). «¿Llega antes
  del jueves?» y «¿qué pasa con el rodamiento?» son preguntas distintas, y una
  frase armada por el sistema obliga a Facundo a levantar el teléfono para
  entender qué le están preguntando. La entrada **nombra el repuesto** igual, y
  **lleva el número de RI** cuando `riDelRepuesto.ts` encontró uno en curso: sin
  eso, contestar empieza por buscar de qué pedido se habla.
- **Una pregunta abierta por repuesto.** Mientras haya una sin responder, el
  botón no abre otra: invita a sumar al mismo hilo («sigue sin llegar»). Dos
  preguntas vivas sobre la misma pieza son dos entradas en la bandeja de
  Facundo que dicen lo mismo, que es el anti-objetivo.
- **Una pregunta se cierra sola cuando deja de tener sentido**, y queda
  registrada como «quedó sin responder» en vez de desaparecer: cuando la OT pasa
  a `REALIZADO` y cuando alguien saca el repuesto de la lista. Sin esto, cada
  pregunta huérfana se queda para siempre en la bandeja y en el conteo diario, y
  el conteo es lo que decide si ese push sigue siendo señal dentro de un mes.
- **Quien preguntó puede cerrarla él mismo** («ya llegó»), por lo mismo.

## Lo que decide el constructor

- El esquema: si la pregunta y la respuesta son filas de
  `ordenes_trabajo_notas` con un tipo y un enlace entre ellas, o una tabla
  propia que el historial de la OT muestra junto con las notas. Lo que no se
  negocia es que **se lean juntas en la OT, en una sola línea de tiempo**.
- Cómo se llama la lista nueva y su migración, siguiendo a `compras_aprobadores`.
- La forma exacta de las dos pantallas.
- Desde cuántos días una pregunta sin responder entra en el resumen diario.
