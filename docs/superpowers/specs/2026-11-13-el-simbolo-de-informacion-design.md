# El símbolo de información, en los once módulos que no lo tienen

Diseño acordado el 13/11/2026.

## Por qué existe

El pedido fue «recorré el sistema y agregá el símbolo de información donde creas
que hace falta», y al preguntar para quién es, la respuesta fue **las dos cosas**:
para que alguien nuevo entienda la pantalla, y para que quien ya la usa deje de
preguntarse qué significa un número.

Al medirlo, el problema no es que falte el símbolo.

**`components/InfoTip.tsx` existe, está bien hecho y se usa 48 veces.** Pero esas
48 viven en **tres módulos**: Mantenimiento, Remises y RRHH. Los otros once
—Compras, Inventario, Producción, Despacho, Facturación, Cantera, Calidad, Taller
Vial, Trituración, Seguridad e Higiene y Ventas— tienen **cero**, repartidos en
213 archivos. Tres módulos lo adoptaron y el resto quedó afuera.

Y hay algo que esto puede arreglar y que es más valioso que la cobertura. **Este
sistema tiene mucho conocimiento medido que vive en los documentos y que quien
mira la pantalla no ve nunca.** Que `gut_orden` no es el puntaje. Que en
Producción un día sin filas es planta cerrada pero un turno en cero dentro de un
día con filas es una parada a explicar. Que el valor de un ensayo de Calidad no
está transformado. Que en el Destape de Cantera el costo de mano de obra propia
sale de una tabla cerrada por `tiene_acceso_rrhh()`, y **a quien no tenga RRHH le
llega 0, sin error** (verificado el 13/11/2026: `lib/cantera/consultas.ts:622`).

Ese último es el mejor ejemplo de lo que este trabajo puede hacer: hoy, en esa
pantalla, un costo de mano de obra en cero y uno real se ven igual.

## Las dos clases de `(i)`, que ya existen en el sistema

Los 48 que hay son de dos tipos, y los dos se piden:

**De pantalla.** Qué es esto y para qué sirve. Va al lado del título. Ejemplo
existente, de Planificación: «Armás el plan de trabajo de un día: elegís qué
órdenes de trabajo se hacen, a quién se asignan, y después generás la hoja para
imprimir o guardar en PDF.»

**De número o campo.** Qué significa exactamente este dato y de dónde sale. Va
pegado al rótulo de la columna o del campo. Ejemplo existente, de MTBF: «Tiempo
medio entre fallas: los días observados divididos por la cantidad de fallas
correctivas del equipo. "Llega a N d" es la probabilidad de aguantar N días sin
una correctiva, **suponiendo que la tasa de falla es constante**.» Nótese que
declara el supuesto: ésa es la vara.

## Aproximaciones

Se consideraron tres.

**1. Primero todas las pantallas, después los números.** Cobertura pareja rápido.
Se descartó porque paga dos veces el costo de entrar a cada módulo: una para
mirar la pantalla y otra, meses después, para entender de dónde sale cada número
—que es la parte cara.

**2. Módulo por módulo, completo. Elegida.** Se abre Compras con `COMPRAS.md` al
lado y salen los dos tipos juntos; después Calidad con `CALIDAD.md`, y así. Cada
módulo queda terminado y revisable, y el conocimiento caro se escribe una sola
vez mientras está fresco.

**3. Sólo los números que los documentos ya explican.** Los `(i)` más valiosos y
nada más. Se descartó porque deja afuera la mitad del pedido.

El motivo de la 2 es el que manda en todo lo que sigue: **la parte difícil no es
poner el ícono, es escribir algo cierto**, y lo que lo vuelve cierto es tener el
documento del módulo abierto.

## La vara: de dónde sale lo que dice un `(i)`

**Un `(i)` de número se escribe sólo si su respuesta ya está escrita en algún
lado** — el documento del módulo, el encabezado de una migración, el docstring de
la función que lo calcula. Si no se puede señalar dónde vive la respuesta, no se
escribe el tooltip.

No es burocracia: las pantallas de este repo **no tienen tests**, así que ninguna
máquina va a notar que un tooltip explica mal una cuenta. Un texto inventado en
pantalla es peor que ningún texto, porque se lee como si el sistema lo
garantizara. La única comprobación posible es que lo que dice el `(i)` esté
respaldado por el documento, y eso exige que el documento esté abierto al
escribirlo.

Corolario, y es una decisión de este diseño: **cuando un número no se entiende y
su explicación no existe en ninguna parte, el hallazgo se anota y no se inventa
el tooltip.** Esos huecos son un resultado del trabajo, no un fracaso.

## Qué lleva `(i)` y qué no

### El alcance es el sistema, no los once módulos

El pedido fue «recorré **el sistema**», y la primera versión de este documento lo
estrechó a los once módulos sin decirlo. Es una contradicción propia: el criterio
de «una acción que no se deshace» apenas se aplica adentro de los once. Medido:
de los 18 archivos de ruta que llaman a `auditar()`, **siete son de Mantenimiento,
dos de RRHH y uno de administración** — diez de los dieciocho quedan afuera.

Y las **pantallas transversales no tienen ningún `(i)` y tampoco estaban en la
cuenta**: `agenda`, `disponibilidad`, `mis-menciones`, `mis-pedidos`,
`mis-avisos`, `administracion`, `mi-cuenta` y el Inicio. Varias cargan
exactamente la clase de advertencia medida que este trabajo dice valorar más: que
en disponibilidad **«agregado» no es anónimo cuando el grupo es chico** —un
sector tiene una sola persona—, que la `TARDANZA` cuenta distinto según quién
pregunta, que en la Agenda divergencia son sólo borrado y movido.

Entonces: **los once módulos son donde está el hueco de pantalla; los criterios
de número y de acción irreversible valen donde se apliquen**, también en
Mantenimiento, RRHH y las transversales. Lo único que sigue valiendo de la
restricción original es que **los 48 `(i)` que ya existen no se tocan** — pero
eso no impide agregar uno nuevo en un módulo que ya tiene otros.

**Lleva:**

- Una pantalla **cuyo título no alcanza para saber qué es**, una sola vez, junto
  al título. **No toda pantalla**: ver abajo.
- Un número que **no es lo que su rótulo sugiere** (`gut_orden`, que no es el
  puntaje).
- Un número que **depende de un supuesto** (el «llega a N días» del MTBF).
- Un número que **puede ser cero por un motivo que no es cero** (la mano de obra
  del Destape sin acceso a RRHH).
- Un dato que **viene de otro lado y puede estar desactualizado** respecto de lo
  que la persona ve (los espejos de planilla; qué manda, el sistema o la
  planilla).
- Una acción **que no se deshace** — las catorce que audita el sistema.

**No lleva:** un rótulo que dice exactamente lo que es. «Fecha», «Proveedor»,
«Cantidad» no necesitan explicación, y ponérsela es lo que arruina el resto.

### Y tampoco lleva donde la pantalla ya lo dice

**La mayoría de las pantallas ya tienen un subtítulo de una línea debajo del
título.** Medido en los once: Calidad **18 de 18**, Ventas 4 de 4, Producción 7
de 8, Compras 8 de 10, Despacho 5 de 6 — pero Taller Vial **1 de 7** y Cantera 9
de 16.

Un `(i)` que repite el subtítulo que está una línea más arriba es exactamente el
tooltip que enseña a no abrir ninguno. Así que **el `(i)` de pantalla va sólo
donde nada en la pantalla contesta ya la pregunta**, y donde va, **tiene que
decir algo que el subtítulo no dice**.

Esto cambia el tamaño del trabajo por siete y es a propósito: sin esta regla
salían unos **85** `(i)` de pantalla; con ella salen alrededor de **una docena**,
concentrados donde de verdad falta —Taller Vial y Cantera a la cabeza—. Es la
diferencia entre cubrir y servir, y el anti-goal de este mismo documento obliga a
elegir servir.

## Goals

- Que los once módulos tengan, por lo menos, un `(i)` de pantalla donde hoy no
  hay nada.
- Que el conocimiento medido que hoy sólo está en los documentos **llegue a la
  pantalla donde importa**.
- Que cada `(i)` nuevo se pueda rastrear a dónde dice eso el sistema.
- Que los huecos encontrados —números sin explicación en ninguna parte— queden
  anotados.

## Non-goals

- **No se tocan los 48 que ya existen.** Funcionan y están bien escritos.
- **No se cambia `InfoTip.tsx`.** Resuelve su problema y tiene una lección cara
  adentro (abajo).
- **No se documenta un módulo que no tenga documento.** Si al abrirlo no hay de
  dónde sacar la verdad, salen los `(i)` de pantalla y los números quedan
  anotados como hueco.
- **No se arregla lo que se encuentre de paso.** Un número mal calculado que
  aparezca mientras se escribe su tooltip se anota; arreglarlo es otro trabajo.

## Anti-goals

- **Que haya un `(i)` al lado de cada rótulo.** Es lo mismo que una notificación
  que suena todos los días: si están en todos lados dejan de leerse todos,
  incluido el que explicaba algo que importaba. De 13 personas, las dos únicas
  que probaron las notificaciones en serio terminaron con los 13 avisos
  descartados; la misma lección vale acá.
- **Que un `(i)` diga algo falso.** Es el peor resultado posible y no hay ninguna
  máquina que lo note. Un número sin explicar deja a la persona como está; uno
  mal explicado la deja peor y convencida.
- **Que quede a medias** — cuatro módulos con `(i)` y siete sin, que es la
  situación de hoy con dos módulos más.

## Restricciones

- **Castellano** en todo, incluidos los textos de pantalla.
- **El globo de `InfoTip` va en `fixed` y eso no es capricho.** En `absolute` lo
  recorta cualquier ancestro con `overflow`, y en este sistema las tablas viven
  dentro de un `overflow-x-auto`. El 18/10/2026 la tabla del MTBF estrenó un
  `(i)` por columna y el globo de las últimas dos salió cortado al medio de una
  palabra. **Lo peligroso es que no se nota al escribirlo** y
  `revisar-responsive.mjs` no lo ve, porque mide clases de Tailwind y esto es
  posicionamiento en tiempo de ejecución. Está resuelto en el componente; quien
  agregue `(i)` no tiene que hacer nada, pero tiene que saber que esa es la razón
  de no «simplificarlo» a `absolute`.
- **Las pantallas no tienen tests.** Nada va a comprobar el texto.
- **Puede haber otra sesión en el mismo árbol**: nunca `git add -A`, los archivos
  van por nombre.
- **El build con `npm run dev` levantado deja la app en 500**: parar el dev server
  antes.

## Lo encontrado de paso, que no es de este trabajo

**Cantera lee el valor hora con su propio `select`** (`lib/cantera/consultas.ts:622`)
en vez de con `valorHoraDe()` de `lib/rrhh/valorHora.ts`. Ese ayudante existe
porque un embed de PostgREST tiene **dos formas posibles** —objeto o arreglo— y
el día que el `select` cambie de forma lo que se rompe es `Number(undefined)` →
`NaN`, que no explota: se propaga. Cantera no tiene esa protección. No se arregla
acá, pero quedó escrito.

## Tres decisiones más, tomadas acá

**Una acción irreversible lleva su `(i)` al lado del botón, y la confirmación no
se toca.** El sistema ya las manda por `useConfirm`, y mejorar ese texto sería
«arreglar lo que se encuentre de paso», que es un non-goal de este documento. El
`(i)` explica qué va a pasar y por qué no se deshace; la confirmación sigue
preguntando lo que pregunta hoy.

**Un módulo sin documento puede terminar con sólo `(i)` de pantalla y una lista
de huecos, y eso cuenta como terminado.** Comprobado: **Taller Vial no tiene ni
documento ni spec**, e Inventario, Cantera, Trituración y Seguridad e Higiene
tienen spec pero no documento de módulo. La vara acepta además encabezados de
migración y docstrings, así que no están necesariamente vacíos — pero si al
mirarlos no hay de dónde sacar la verdad, los números quedan anotados. Es
exactamente lo que quiere decir «los huecos son un resultado del trabajo».

**Ventas va último.** Sus dos migraciones no están aplicadas y ninguna de sus
pantallas se abrió nunca en un navegador, así que un `(i)` escrito ahí no se
puede ver funcionando y se apoya en código que todavía se va a mover.

## Los textos no se revisan antes de salir

Preguntado el 13/11/2026 y contestado «pusheá no más»: **no hay paso de revisión
previa de los textos**. Se escriben, salen, y se corrigen viéndolos en pantalla.

Lo que eso cuesta, dicho para que nadie lo descubra después: **una frase
equivocada va a vivir en producción hasta que alguien la lea y la note**, y como
se lee con la autoridad del sistema, es probable que tarde. Por eso la vara de
arriba —no escribir un `(i)` cuya respuesta no esté ya escrita en algún lado— no
es negociable: es la única defensa que queda.

Y una razón más para no confiar de más en los documentos: **también se
desactualizan**. El 13/11/2026, escribiendo este diseño, se encontró que
`CLAUDE.md` dice que Cantera lee el valor hora con `valorHoraDe()` y en realidad
lo lee con su propio `select` (`lib/cantera/consultas.ts:622`). Un documento
viejo produce un tooltip viejo. Cuando el documento y el código discrepan, **manda
el código**, y la discrepancia se anota como hueco.

## Lo que queda a criterio de quien planifique

- El orden del resto. Lo único que este diseño fija es que **Compras y Calidad
  conviene que vayan temprano** —son los que más conocimiento medido tienen
  escrito y sin mostrar—, que **Taller Vial y Cantera son los que más necesitan
  el `(i)` de pantalla** (1 de 7 y 9 de 16 con subtítulo), y que Ventas va
  último.
- Qué cuenta como «pantalla principal» de cada módulo — la raíz y sus secciones
  del menú es el criterio obvio, pero cada módulo tiene su forma.
- Si los huecos encontrados se anotan en el documento del módulo, en un documento
  propio, o como comentarios en el código.
- Si conviene un `scripts/revisar-infotips.mjs` que liste pantallas sin ninguno.
  Serviría para no volver a quedar con tres módulos adentro y once afuera, pero
  **no puede decir si un texto es cierto**, que es lo único que importa acá; la
  costumbre del repo además es dejar un chequeo nuevo fuera del CI hasta que sus
  excepciones se asienten.
