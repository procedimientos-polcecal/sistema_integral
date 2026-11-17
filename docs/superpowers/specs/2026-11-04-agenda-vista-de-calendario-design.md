# La Agenda se ve como un calendario

**Fecha:** 04/11/2026
**Estado:** acordado, sin empezar
**Toca:** `app/(app)/agenda/`, `lib/agenda/vista.ts`, `lib/agenda/listar.ts`

---

## Qué es esto y por qué

La Agenda salió a producción el 03/11/2026 como **una lista de tarjetas**: los
próximos arriba, el último mes detrás. Funciona, pero no se parece a lo que la
gente que la usa mira todos los días.

El pedido es que **se vea como el calendario de Google**, y cuando se preguntó
qué quería ver de un vistazo la respuesta fue precisa: **la semana con la
cuadrícula de días y horas**.

El porqué está en el diseño original de la Agenda y no cambió: esto lo usan
encargados para organizarse administrativamente —reuniones, tareas puntuales,
seguir las OT de los próximos días—. Una lista contesta «qué tengo», pero no
contesta «cómo viene la semana», que es la pregunta que uno le hace a un
calendario. Y como las catorce personas ya leen Google Calendar todos los días,
la forma no hay que enseñarla.

Esto es **sólo la pantalla**. No se toca el modelo de datos, ni las rutas de
escritura, ni la conexión con Google, ni el cron, ni los avisos.

---

## Lo que decidió el usuario

1. **La vista principal es la semana**, con la cuadrícula de días por horas.
2. **En el celular, un día por vez**, con la misma cuadrícula y flechas para
   moverse. Se le mostró también una vista de tres días y la descartó después de
   mirarla.
3. **Se usa sobre todo en la computadora**, pero también en el celular.
4. **Las vistas son tres: Semana, Día y Lista.** Se preguntó explícitamente por
   la vista de Mes y la respuesta fue que no hace falta.
5. **Una alerta se resuelve sin salir del calendario.** Al hacer clic en un
   evento —en su bloque de la grilla o en la banda de arriba— se abre un detalle
   con todo: los datos, el texto completo de la alerta y los tres botones («Ya
   lo vi», «Volver a poner lo del sistema», «Aceptar lo de Google»). Se le
   ofreció la alternativa barata —que la banda fuera un enlace a la vista Lista,
   sin tocar nada de lo que ya funciona— y la descartó sabiendo que ésta cuesta
   bastante más trabajo. El motivo: destrabar no es raro, pasa cada vez que
   alguien toca un evento desde su teléfono, y mandar a la persona a otra vista
   para eso es la clase de fricción que termina con la alerta ignorada.

---

## Lo que decidí yo

Van marcadas como mías para que se puedan discutir sin creer que están
acordadas.

### 1. La banda de alertas queda fija arriba, en las tres vistas

Es lo único de esta pantalla que Google Calendar no tiene, y es deliberado.

La Agenda avisa cuando alguien movió o borró un evento del lado de Google: el
SdG deja de seguirlo y hay que destrabarlo. Hoy eso se lee en la tarjeta del
evento. **Una cuadrícula no tiene dónde poner esa frase**, y si al pasar de
lista a calendario la alerta se pierde, se pierde en silencio —que es
exactamente la clase de falla que esta Agenda existe para evitar, y la que este
repo persigue en todos sus módulos—.

Entonces: una banda arriba de la grilla, con la cuenta y el nombre de los
eventos con alerta, que lleva al evento. **Un evento divergido se pinta además
distinto en la grilla** (naranja, con una marca), para que se vea también en su
lugar y no sólo en la banda.

La banda nombra eventos **de cualquier fecha**, incluso de semanas que no se
están mirando. Esto es una consecuencia de la lectura actual, que trae todo lo
divergido sea de cuando sea, y hay que mantenerla.

### 2. Hacer clic en un hueco vacío crea un evento ahí

Con el día y la hora ya puestos en el formulario. Es el gesto que define a
Google Calendar, y hoy no existe: hay que apretar «Nuevo evento» y cargar la
fecha a mano. El botón «Nuevo evento» se queda igual, para quien prefiera eso.

### 3. La vista Lista no se tira

Queda como la tercera vista, con lo que la pantalla muestra hoy. No es
nostalgia: es la única que tiene lugar para el **texto completo** de una alerta
de divergencia, para los botones de destrabar, para el aviso de «no llegó a
Google» y para el **«ver todo el historial»**. Una grilla de semana no puede
mostrar nada de eso sin abrir el evento.

### 4. Se dibujan las 24 horas, no un recorte

Tentaba recortar la grilla a 04:00–20:00, que es donde caen los turnos (04:00,
08:00 y 12:00) y por lo tanto todas las OT. **No se hace.** Un evento propio se
puede crear a cualquier hora, y uno que vino de Google y alguien aceptó puede
estar en cualquier lado. Un evento que cae fuera del rango dibujado **no se ve y
nada avisa**: es la misma familia de fallas que el resto del documento evita.

Se dibujan las 24 y la grilla arranca desplazada a una hora razonable (ver «Lo
que queda al constructor»).

### 5. Dos eventos a la misma hora se dibujan lado a lado

Como en Google. **No se apilan ni se tapan**, por lo mismo del punto anterior.
Ésta es la pieza con más chance de salir mal en silencio y es la que justifica
que haya lógica pura con tests.

### 6. El día que se mira y la vista van en la URL

`/agenda?vista=semana&dia=2026-11-04`.

No es cosmético: la pantalla es un Server Component y **la lectura de eventos
vive ahí** (no hay `GET` en `/api/agenda`, se borró a propósito porque nadie lo
llamaba). Si la semana que se mira viviera sólo en estado de React, navegar a
una semana vieja no podría traer sus eventos sin agregar una ruta de lectura
nueva y repetir del lado del cliente lo que hoy resuelve RLS.

Con el día en la URL, mover la semana es una navegación, el Server Component
vuelve a leer con la ventana que corresponde, y no se agrega ninguna ruta. El
costo asumido es que cada flecha es una ida al servidor.

### 7. La semana va de lunes a domingo, con el fin de semana sombreado

Siete columnas. La planta opera con turno de 04:00, así que el fin de semana no
se puede esconder, pero se distingue.

### 8. El ancho no cambia la vista: la vista Semana, en un teléfono, dibuja un día

Es la salida a una contradicción que tenía este documento. Decir «la vista por
defecto la decide el ancho» y «la vista vive en la URL» a la vez no se puede: la
pantalla es un Server Component y el ancho sólo se conoce en el navegador. Todo
link que llega a la Agenda —el push, la campana— apunta a `/agenda` pelado
(`URL_DEL_AVISO` en `lib/home/avisos.ts`), así que el servidor tendría que
elegir una y que el cliente la corrigiera después: un parpadeo, una ida más al
servidor, y la URL corregida quedando pegada.

La salida es que **no haya dos vistas que elegir**. `vista=semana` es la vista
por defecto siempre, y en un ancho de teléfono esa misma vista dibuja **un solo
día** —el de `dia`—. No hay redirección, ni parpadeo, ni que adivinar el ancho
en el servidor.

Lo único que sí depende del ancho es **cuánto avanzan las flechas**: siete días
en la computadora, uno en el teléfono. Eso se resuelve en el cliente con una
media query y es lo que la persona espera de lo que está viendo.

La vista `Día` explícita se queda, para quien en la computadora quiere mirar un
día solo.

### 9. Un evento que cruza la medianoche se parte en un pedazo por día

Como hace Google. El modelo lo permite, el código ya lo contempla
(`cruzaLaMedianoche`, el corrimiento de días de `horarioParaGuardar`) y
«aceptar lo de Google» puede traer uno. Dibujarlo sólo en el día en que empieza,
recortado, deja un evento que existe y no se ve en el día en que efectivamente
ocurre — que es un anti-objetivo de este documento.

Esto decide la forma de la lógica pura: **lo que se reparte en columnas son
pedazos de un día, no eventos.** El evento se parte primero y se acomoda
después.

### 10. El aviso de «no llegó a Google» va también a la banda

La banda no es sólo para la divergencia. Hoy la tarjeta muestra además
`avisoDelPendiente()` —un evento guardado en el SdG que **no está en el
calendario de nadie**— y la columna `aviso`, que es «algo que mirar» y puede
existir sin divergencia. En una grilla ninguno de los dos tiene dónde ir, y si
la banda no los nombra, alguien que vive en la vista Semana no se entera nunca.

**Esto tiene una consecuencia en la consulta**: hoy `traerEventos` trae los
divergidos de cualquier fecha, incondicionalmente, pero **no los pendientes**.
Un pendiente viejo no se leería, así que la banda no podría nombrarlo. La
condición tiene que cubrir los dos.

### 11. La vista Lista ignora el día que se está mirando

Si alguien navega a la semana de marzo y cambia a Lista, Lista no muestra marzo:
sigue con su regla de hoy —lo que viene más los últimos 30 días, y todo con
`historial=1`—. Es lo que esa vista contesta bien y lo que ya está probado;
`separarProximosYPasados` sigue recibiendo lo que espera.

---

## Objetivos

- Que la semana se lea de un vistazo en la computadora: qué días están cargados,
  a qué hora, y qué se superpone.
- Que **todo lo que la pantalla hace hoy se siga pudiendo hacer**: crear,
  editar, borrar, invitar, «ya lo vi», destrabar, y ver los avisos de Google
  pendiente.
- Que funcione en un teléfono de 343 px de ancho útil.

## No objetivos

- **La vista de Mes.** Se preguntó y no la quieren.
- **Arrastrar un evento para moverlo.** Mover un evento sigue siendo abrir el
  formulario y cambiar la hora. Arrastrar en una grilla es mucho trabajo y, en
  esta pantalla, cada movimiento escribe en Google: un arrastre accidental le
  manda un correo a cinco personas.
- Cambiar el modelo de datos, las rutas de escritura, el cron, los canales de
  Google o los avisos.
- Mostrar el calendario de otra persona. Cada uno sigue viendo lo suyo y aquello
  a lo que lo invitaron, que es lo que RLS permite.

## Anti-objetivos

Esto sería un fracaso aunque la pantalla funcione:

- **Que una alerta de divergencia deje de verse.** Es la mitad de la razón de
  ser de la Agenda.
- **Que un evento exista y no se dibuje**, por caer fuera del rango de horas, por
  superponerse con otro, o por caer en una semana cuya ventana de datos no se
  pidió.
- **Que la grilla quede inusable en el teléfono**, que es donde está la mitad
  del equipo desde que el SdG se instala.
- Que el texto completo de un aviso de Google quede sin lugar donde leerse.

---

## Restricciones

- **Next.js 16 (App Router), React, Tailwind v4.** Todo en castellano: nombres,
  comentarios y textos de pantalla.
- **`.input`, `.card` y los `.btn-*` están fuera de capa** y le ganan a
  cualquier utilidad de Tailwind que declare la misma propiedad (ver
  `CLAUDE.md`). Un ancho de columna no se le pone a uno de esos elementos: va en
  un contenedor.
- **`grid-cols-7` sin breakpoint es exactamente lo que
  `scripts/revisar-responsive.mjs` marca.** Acá hay siete columnas a propósito,
  así que o lleva su breakpoint o entra en la lista de excepciones del script
  **con el porqué escrito**. No se deja marcando en rojo.
- **Las pantallas no tienen tests en este repo.** Toda decisión que se pueda
  equivocar en silencio —el reparto de columnas de los eventos superpuestos, el
  cálculo de la posición y el alto, los límites de la semana, la ventana de
  datos— va a `lib/agenda/` y se prueba con vitest. Lo que queda en el
  componente es dibujar.
- **La hora es siempre la de pared de Argentina.** Hay `diaYHoraDe()`,
  `fechaEnArgentina()` y `etiquetaDelDia()` en `lib/agenda/vista.ts` y
  `lib/core/fechas.ts`. **La grilla no usa nunca la hora local del navegador**:
  en una computadora con el reloj en otra zona, los eventos se correrían de fila
  sin que nada avise.
- **La lectura sigue siendo con el cliente del usuario**, para que corran las
  policies. El cliente admin se usa sólo para el directorio de nombres, como
  hoy.

---

## La ventana de datos

Es el único punto donde el cambio de pantalla toca algo que no es pantalla, y
conviene entenderlo antes de tocarlo.

`traerEventos()` (en `lib/agenda/listar.ts`) pide hoy:

```
fin >= (hace 30 días)   OR   divergencia is not null
```

O sea: **hacia adelante no tiene techo**. Navegar a la semana que viene, o a la
de marzo de 2027, ya trae los eventos — no hay nada que hacer. Lo único que
vendría vacío es una semana de **más de 30 días hacia atrás**, y vendría vacía
sin avisar, que es justo un anti-objetivo.

La ventana pasa entonces a depender del día que se mira:

```
desde = el menor entre (el inicio del rango visible) y (hace 30 días)
```

Y la condición incondicional deja de ser sólo la divergencia: por la decisión 10
hay que traer siempre, de cualquier fecha, **lo divergido y lo que quedó
pendiente de escribir en Google**. Si no, la banda promete nombrar algo que la
consulta no leyó.

El `historial=1` que hoy saca la ventana se mantiene para la vista Lista.

## Lo que hay que mover de lugar

La decisión 5 del usuario —resolver una alerta sin salir del calendario— es la
parte cara de este trabajo, y conviene que el plan la mire de frente.

Hoy el texto completo de la alerta, el panel de divergencia y los tres botones
viven **dentro de `TarjetaDeEvento`**, junto con la plomería que los acciona: el
`confirm`, el estado de «ocupado», y el `accion()` de `AgendaClient` que llama a
la ruta, lee la respuesta y recarga. Para que el detalle que se abre desde la
grilla muestre lo mismo, eso tiene que salir de la tarjeta a algo compartido que
usen las dos pantallas.

Es el pedazo con más chance de romper algo que hoy funciona. **Lo que no puede
cambiar es el comportamiento**: qué botones aparecen lo sigue decidiendo
`permisosDelEvento()`, los textos de confirmación son los mismos, y las rutas se
llaman igual. Si algo de eso se mueve, se mueve a propósito y se dice.

---

## Lo que queda al constructor

- **El reparto de los eventos superpuestos**: cuántas columnas, cuáles se
  solapan con cuáles, y qué pasa cuando son muchos. Google deja ver todos; la
  forma exacta es del constructor, pero **no puede haber un evento que no se
  dibuje**.
- **A qué hora arranca desplazada la grilla.** Sugerencia: a la hora del primer
  evento del rango visible, y si no hay eventos, cerca de las 06:00 (antes del
  turno de 08:00, después del de 04:00).
- **Si el detalle abre en un modal o en un panel lateral**, y cómo se reparte
  entre componentes. Lo que tiene que mostrar ya está decidido (decisión 5 del
  usuario y «Lo que hay que mover de lugar»); la forma, no.
- **Los colores exactos.** La idea es la de Google: bloques de color plano,
  texto blanco. Que las OT se distingan de los eventos propios, y que el
  divergido se note. El color de estado va por `style` y no por utilidad de
  Tailwind, como ya hacen los badges de Mantenimiento.
- **Cómo se navega en el teléfono** más allá de las flechas (deslizar, o no).
- **Si la vista elegida se recuerda entre visitas.** No se pidió.

---

## Cómo se comprueba

Lo de siempre (`CLAUDE.md`), y dos que importan especialmente acá:

```bash
npm test
npx tsc --noEmit
npm run build
node scripts/revisar-responsive.mjs    # las siete columnas
node scripts/revisar-arbol-commiteado.mjs
```

Y lo que ningún script puede ver, porque la pantalla está detrás del login:
**abrir `/agenda` en el navegador, en la computadora y en el teléfono**, con un
evento propio, uno de OT y, si se puede, uno divergido. La Agenda ya se
desplegó una vez sin que nadie hubiera abierto la pantalla; no conviene repetirlo.

**Dos cosas del estado real, medidas el 04/11/2026**, porque cambian qué se
puede comprobar y porque `CLAUDE.md` todavía dice lo contrario (dice que la
migración no está aplicada y que la pantalla nunca se abrió: las dos son falsas,
y esa fila hay que corregirla con este trabajo):

- La migración **está aplicada** y `agenda_eventos` tiene **2 filas** en
  producción: un evento de OT para el 07/11 y uno de prueba. O sea que la
  pantalla se puede abrir y mirar de verdad.
- Con dos eventos **no hay con qué ejercitar la superposición**. Esa lógica no
  la va a comprobar nadie mirando: la única defensa que va a tener son sus
  tests de vitest, y por eso vive en `lib/`.
