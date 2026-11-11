# Los formularios no pierden lo cargado

Diseño acordado el 11/11/2026.

## Por qué existe

El pedido, textual: «si sin querer hago clic afuera y me lo cierra, que guarde lo
registrado hasta ese entonces… Si pongo cancelar, que sí borre lo llenado». El
caso que lo motivó: cargando una OT, un toque fuera del formulario lo cerró y se
perdió todo.

Al medirlo apareció que el problema es peor que el accidente.

**`RegistrarOTModal` se cierra al tocar el fondo, sin preguntar y sin guardar.**
Su fondo lleva `onClick={onCerrar}` (línea 206) y el formulario tiene **17
campos**. Al lado, en la misma carpeta, **`NuevaOTModal` no se cierra**: su fondo
no tiene ningún `onClick`. Dos formularios de OT, hermanos, con comportamiento
opuesto.

Medido en todo el sistema el 11/11/2026: hay **45 modales** con fondo y **24 se
cierran al tocarlo**; los otros 21 no. **No existe ningún componente de modal
compartido**: cada pantalla se armó el suyo. Así que la diferencia no es una
decisión de diseño sino el azar de quién lo escribió, y eso es lo que hace que la
misma acción destruya trabajo en una pantalla y no en la de al lado.

Los que se cierran incluyen varios largos: registrar OT, alta de requerimiento de
compra, nueva condición de Seguridad e Higiene, iniciar OT, repuestos de la OT.

## Qué se construye

**El componente de modal que nunca existió**, y los 45 pasan por él. Ese
componente hace tres cosas:

1. **Recuerda lo cargado mientras la app esté abierta.** Se cierra el formulario
   por accidente, se vuelve a abrir, y lo escrito sigue ahí.
2. **Pregunta antes de cerrarse cuando hay algo escrito.** Con el formulario
   vacío cierra derecho; con algo cargado, pregunta.
3. **Tira el borrador al cancelar y al confirmar.**

### Las dos mitades no cuestan lo mismo, y por eso van en dos etapas

La primera versión de este documento decía que el componente compartido evitaba
tocar 45 archivos. **Es cierto para la segunda y la tercera, y falso para la
primera**, que es la que se pidió.

Cerrar, preguntar y tirar al cancelar los puede hacer un envoltorio: es una línea
por modal. **Recordar no se puede desde afuera.** Cada modal guarda sus campos en
una docena de `useState` sueltos —`RegistrarOTModal` tiene doce— mezclados con
estado que no es el formulario: `guardando`, el error, la foto, las listas de
operarios que vinieron del servidor. Y al cerrarlo el padre, el componente se
desmonta y se lleva todo. Para que recuerde, **cada modal tiene que juntar sus
campos en un solo objeto**: no es envolver 45 archivos, es reformar el estado de
45 archivos.

De ahí el orden, decidido con el costo real a la vista:

- **Etapa 1 — que ninguno se cierre por accidente: en los 45.** Resuelve el
  accidente que originó el pedido, en todo el sistema, sin reformar nada.
- **Etapa 2 — que recuerden: por módulo, empezando por Mantenimiento**, que es
  donde pasó, y siguiendo por los formularios largos.

El destino es el mismo —todos—, pero una reforma del estado de 45 archivos de un
saque, en un repo donde suele haber otra sesión en el mismo árbol, es pedir una
colisión.

## Las decisiones que tomó el usuario

**El borrador vive mientras la app esté abierta, y no más.** Cerrar la app lo
pierde. Esto se eligió explícitamente: no hay que guardarlo en la base ni a largo
plazo en el teléfono, así que no se acumulan borradores viejos ni aparece el de
la semana pasada en un formulario nuevo. Vive y muere con la sesión.

**Va en todos los formularios**, no sólo en los largos.

**Al tocar afuera, pregunta cuando hay algo escrito** — de las tres salidas
posibles (que todos cierren, que ninguno cierre, que pregunte), ésta es la
elegida.

**Cancelar borra lo cargado.** Es el pedido textual.

## Las decisiones que tomé yo

Marcadas como mías para que se puedan revisar.

**El borrador se acuerda de qué registro estaba abierto.** Si se abre la OT 2905,
se escribe, se cierra, y después se abre la 2907, tiene que aparecer vacía. Es la
trampa más fácil de este tipo de cosas y es **silenciosa**: nadie se entera hasta
que guarda en el lugar equivocado. Un modal que edita algo existente necesita
entonces una clave que incluya qué está editando, y un modal de alta una que lo
distinga de los demás.

**Confirmar también borra el borrador, no sólo Cancelar.** Si no, se carga una
OT, se registra, se abre el formulario para la siguiente y aparece la anterior
entera. El pedido sólo nombraba Cancelar, pero la alternativa es absurda.

**La X y el fondo hacen lo mismo: cierran y conservan.** Cancelar es lo único que
tira. La regla queda aprendible en una frase —«Cancelar tira, todo lo demás sale
y guarda»— y es la única repartición en la que un movimiento distraído nunca
destruye nada.

**Escape se comporta como el fondo**, por lo mismo.

**Preguntar es sobre la interrupción, no sobre la pérdida.** Como el borrador se
guarda igual, el cartel no puede decir «se va a perder lo cargado», porque sería
mentira. Dice que hay algo a medio cargar y ofrece seguir ahí; si se cierra, lo
cargado espera.

**De los 45, no todos son formularios, y los que no lo son sólo heredan el
cierre.** Hay un cajón de navegación del celular (`Sidebar.tsx`, que es una capa
oscura sin panel), el panel del asistente, y cuatro pantallas de sólo lectura
—`DetalleOS`, `HojaDePersona`, `PlanDetalle` y la caja de compartir de
`remises/hoy`, cuyo textarea es `readOnly`—. Ahí «hay algo a medio cargar» no
quiere decir nada, y **hacer que el cajón de navegación deje de cerrarse al tocar
afuera sería una regresión**. Todos usan el componente; el borrador se activa
sólo donde se declara uno.

**La clave del borrador incluye de dónde salió el formulario, no sólo qué
registro edita.** Varias altas nacen prellenadas desde otra cosa: `GenerarOTModal`
desde un aviso, `GenerarOTDeMantenimiento` desde un plan, `NuevoRequerimientoModal`
desde un requerimiento anterior. Con una clave genérica —`"nueva-ot"`— un borrador
empezado desde el aviso 5 reaparece sobre un alta en blanco: es el mismo
anti-goal por una puerta que la regla del registro no cubría, y con el mismo
silencio.

**El borrador guarda sólo lo que la persona tocó**, y al restaurarlo los demás
campos se vuelven a leer del registro. Es lo que evita que un borrador de hace
rato pise con valores viejos un registro que cambió mientras tanto: `RegistrarOTModal`
manda en un solo `PATCH` las horas, el contratista, los tres operarios y la falla,
así que restaurar todo entero reescribiría también lo que otro corrigió. La app
está instalada en los teléfonos desde el 16/10/2026, así que «mientras la app esté
abierta» pueden ser días.

**El borrador se tira cuando el guardado salió bien, no al apretar el botón.**
`RegistrarOTModal` hace un `POST` y después un `PATCH`, y si el segundo falla el
modal queda abierto con el error: tirarlo al empezar sería perder todo
justamente cuando el guardado falló, que es el bug original. (Que un reintento
tras un fallo a medias pueda duplicar la ejecución es un problema anterior a esto
y no lo arregla este trabajo.)

**Cancelar y la X son hoy el mismo callback, y dejan de serlo.** En
`RegistrarOTModal` el fondo (línea 206) y el botón Cancelar (línea 359) llaman
los dos a `onCerrar`; `IniciarOTModal` igual. La regla para separarlos es
mecánica: **el que tira es el botón negativo del formulario** —el que hoy dice
Cancelar—, y todo lo demás —la X, el fondo, Escape— sale conservando. Una
pantalla de sólo lectura cuyo botón dice «Cerrar» no tira nada porque no hay nada
que tirar.

**Va a haber un `scripts/revisar-modales.mjs`.** Sin él, el próximo que escriba
`fixed inset-0` a mano vuelve a empezar — que es exactamente la falla que el
repo ya contesta con `revisar-responsive` y `revisar-exportaciones` para sus
gemelas. Siguiendo la costumbre del repo, **no entra al CI** hasta que su lista
de excepciones aguante unas semanas.

## Lo que hay que saber antes de construirlo

**`ConfirmProvider` tira a propósito si el módulo no lo montó.** Está en
[components/ConfirmProvider.tsx](../../../components/ConfirmProvider.tsx) y su
docstring explica por qué: antes devolvía `false`, que se lee como «el usuario
canceló» y es mentira, y eso dejó un botón muerto nueve días en
`/inventario/stock` sin que lo notara el build ni la suite.

Eso vuelve el preguntar un problema de cobertura, medido el 11/11/2026:

| | |
|---|---|
| Módulos que montan `ConfirmProvider` | administración, agenda, cantera, compras, inventario, mantenimiento, remises, rrhh |
| Módulos con modal | administración, agenda, compras, inventario, mantenimiento, **producción**, remises, rrhh, **seguridad e higiene** |

**`producción` y `seguridad e higiene` tienen modales y no montan el
proveedor.** Si el modal compartido usa `useConfirm` sin más, esos dos revientan
en el primer clic afuera con algo escrito. Lo que no se puede es ignorarlo: el
proveedor está escrito para que se note, y se va a notar.

**Y hay tres caminos, no dos — el tercero ya está en el árbol.** Ninguno de esos
dos módulos tiene `layout.tsx`, y Seguridad e Higiene ya resolvió lo suyo
montando su propio `<ConfirmProvider>` adentro de
`condiciones/FichaDeCondicion.tsx`, alrededor de los hijos. Así que las opciones
son: montarlo en un `layout.tsx` nuevo por módulo, seguir ese precedente por
pantalla, o **montarlo una vez en `app/(app)/layout.tsx`**, que cubriría los doce
de golpe y cerraría el agujero para siempre. La última es la que mejor encaja con
que esto tiene que heredarse «sin que haya que acordarse», pero cambia un archivo
que usan todos y por eso queda a criterio de quien planifique.

**Hoy `localStorage` se usa en cuatro lugares nada más.** Nada de esto debería
sumarse ahí: el borrador no tiene que sobrevivir a cerrar la app, y guardarlo en
`localStorage` lo haría sobrevivir, que es justo lo que se descartó.

## Goals

- Que un toque distraído fuera del formulario **no destruya trabajo**, en ninguna
  de las 45 pantallas.
- Que la misma acción haga **lo mismo en todas**: hoy destruye en 24 y no hace
  nada en 21.
- Que **Cancelar siga siendo la forma de tirar** lo cargado, explícita y sin
  sorpresas.
- Que agregar un modal nuevo **herede esto sin que haya que acordarse** — es la
  misma vara que `<Select>`, que decide solo, y que los `:disabled` de
  `globals.css`, que un botón nuevo hereda.

## Non-goals

- **No sobrevive a cerrar la app.** Elegido por el usuario. Tampoco a recargar la
  página si el mecanismo elegido no lo cubre; lo que importa es el formulario que
  se cierra, no el navegador que se va.
- **No se guarda nada en la base.** Un borrador no es un dato del sistema.
- **No es carga offline.** Eso ya existe en `app/cargar/` con su propia cola y no
  se toca.
- **No cambia qué valida ni qué manda cada formulario.** Sólo cuándo se cierran y
  qué recuerdan.
- **No unifica el aspecto de los 45 modales.** Pueden seguir viéndose como se
  ven; lo que se comparte es el comportamiento.

## Anti-goals

Lo que haría fracasar esto aunque funcione:

- **Que un borrador aparezca en el registro equivocado.** Es peor que el problema
  original: perder lo cargado se nota; guardarlo sobre otra OT, no.
- **Que preguntar se vuelva un trámite.** Si el cartel sale con el formulario
  vacío, o sale dos veces, la gente aprende a apretar sin leer — y el próximo
  cartel, el que sí importaba, también.
- **Que un modal reviente** porque su módulo no monta el proveedor.
- **Que quede a medias**: diez modales con el componente nuevo y treinta y cinco
  como estaban es la inconsistencia de hoy con una capa más.

## Restricciones

- **Castellano** en todo: nombres, comentarios, texto de pantalla y de commit.
- **Puede haber otra sesión en el mismo árbol.** Nunca `git add -A`; los archivos
  van por nombre. Al 11/11/2026 el checkout principal está en la rama de otra
  sesión.
- **`className="input w-20"` no mide 20** y `.card` con `border-*` no pinta el
  borde: las clases de `globals.css` están fuera de capa y le ganan a las
  utilidades. Un modal nuevo lo va a pisar seguro.
- **Una grilla de tres columnas lleva breakpoint** y una `<table>` va con scroll;
  lo comprueba `node scripts/revisar-responsive.mjs`.
- **Las pantallas no tienen tests** en este repo. Lo que decida algo —qué cuenta
  como «hay algo escrito», cómo se arma la clave del borrador, cuándo se tira—
  tiene que salir del componente a una función pura para poder probarlo, que es
  lo que ya hizo `repartirRegistroDeOT`.
- **El build con `npm run dev` levantado deja la app en 500**: parar el dev server
  antes.

## Lo que queda a criterio de quien planifique

- Dónde vive el borrador: estado en memoria, `sessionStorage`, o un contexto de
  React. Lo que manda es la restricción de arriba —que no sobreviva a cerrar la
  app— y que recargar la página no es el caso que se pidió resolver.
- Cuál de los tres caminos se toma para el `ConfirmProvider` que les falta a
  Producción y a Seguridad e Higiene.
- Qué cuenta exactamente como «hay algo escrito» en un formulario que nace con
  valores por omisión — comparar contra el estado inicial y no contra vacío es lo
  que evita que el cartel salga cuando nadie tocó nada.
- Si el formulario avisa de alguna forma que lo que muestra es un borrador
  recuperado, o si simplemente aparece lleno.
- El orden de los módulos dentro de la etapa 2, después de Mantenimiento.
- Qué mira exactamente `revisar-modales.mjs`: lo mínimo es que un `fixed inset-0`
  que no venga del componente compartido salga como hallazgo.
