# Mantenimiento prioriza sus órdenes de trabajo con la matriz GUT

Acordado el 21 de octubre de 2026. Agrega a cada orden de trabajo tres notas de
1 a 5 —**gravedad, urgencia y tendencia**— cuyo producto da un puntaje de 1 a
125 que decide en qué orden conviene atacarlas.

Se puntúa **sólo desde el SdG**. El formulario de Google no se toca. Las
órdenes que entran por el formulario llegan sin puntaje y el sistema sugiere
ponérselo, sin obligar.

Necesita **una migración**: tres columnas nuevas en `ordenes_trabajo`, una
cuarta generada que sirve de clave de orden, y su índice. No escribe nada en
ninguna planilla.

## Para qué

Hoy no hay priorización de verdad, y los números lo dicen. Medido contra la
base el 21/10/2026:

| | |
|---|---|
| Órdenes cargadas | 2.224 |
| Pendientes (`ATRASADO`, `POR_HACER`, `EN_PROCESO`) | 45 |
| Sin ninguna prioridad cargada | 2.053 (92,3%) |
| De las 45 pendientes, sin prioridad | 29 |
| De las 45 pendientes, con prioridad **Alta** | **0** |
| Órdenes con `orden_manual` desde que existe la función | **0** |

O sea: de las 45 que esperan algo, 29 no dicen nada, 14 dicen "Media" y 2
dicen "Baja". El orden sugerido de
[lib/mantenimiento/prioridad.ts](../../../lib/mantenimiento/prioridad.ts)
desempata por prioridad, pero con esos datos **el desempate no desempata nada**
y todo termina ordenado por fecha. Y la pantalla de arrastrar para reordenar a
mano, que existe desde la integración, no se usó **ni una vez** en 2.224
órdenes.

El argumento de fondo no es que falte un campo, sino que **"esta OT es alta" es
una opinión y no se discute**. "Gravedad 4, urgencia 5, tendencia 4" son tres
preguntas que dos personas pueden contestar por separado y después comparar.
Esa es la razón por la que el área eligió GUT y no otra escala.

La fuente es la presentación de Pedro Cousseau sobre matriz GUT aplicada a
gestión de mantenimiento, que el área trajo como material de referencia.

## Las tres escalas

Las palabras son las del material de origen y se usan tal cual. No se
reescriben "para que suenen mejor": son las que el área ya leyó.

| | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| **Gravedad** | No reviste gravedad | Poco grave | Grave | Muy grave | Extremadamente grave |
| **Urgencia** | Mucho tiempo disponible | Bastante tiempo disponible | Poco tiempo disponible | Muy poco tiempo disponible | Sin tiempo disponible |
| **Tendencia** | No sucederá nada | Empeorará a largo plazo | Empeorará a medio plazo | Empeorará a corto plazo | Empeorará muy rápidamente |

**Puntaje = G × U × T**, de 1 a 125.

### Las tres van juntas o no va ninguna

Una orden tiene puntaje sólo si tiene las tres notas. Media puntuación no es
media prioridad: es un número que parece una medición y no lo es. Dos de tres
cargadas se guardan —alguien puede estar a mitad de camino— pero la orden sigue
contando como **sin puntaje** a todos los efectos.

### Los tres desplegables arrancan vacíos, y no son obligatorios

El desplegable de `prioridad` que tienen al lado en `NuevaOTModal` arranca en
`"🟡 Media"` y no tiene opción vacía. **El GUT no copia esa costumbre**, y vale
la pena decir por qué: tres desplegables en 3 por defecto fabrican un puntaje de
27 que nadie contestó. En el orden daría lo mismo que no tener puntaje —27 es
justamente el valor de "sin puntaje"— pero en pantalla se imprimiría como un
número, que es exactamente el "número que parece una medición" que este
documento rechaza.

Así que los tres arrancan en una opción vacía y crear una orden sin GUT se
puede. **No se toca `loQueFaltaParaCrear` de
[lib/mantenimiento/altaDeOT.ts](../../../lib/mantenimiento/altaDeOT.ts)**: la
lista de campos obligatorios queda como está. "Sin obligar" vale para los dos
caminos de alta, no sólo para el formulario.

## El GUT se puntúa en el SdG, nunca en el formulario

Esta es la decisión que más condiciona todo lo demás, y se tomó sabiendo lo que
cuesta.

**De las 2.224 órdenes, 15 se crearon en el SdG. Las otras 2.209 entran por el
formulario de Google.** O sea que "puntuar cuando se carga la OT" es, el 99,3%
de las veces, alguien llenando un Google Form.

Aun así el formulario no se toca, por tres razones:

1. **Las columnas A–J y S de la pestaña `OT` son el derrame de cuatro
   `QUERY(IMPORTRANGE(...))`.** Agregar preguntas al formulario mueve columnas
   que el sincronizador lee por posición. El 16/10/2026 un desacomodo de ese
   tipo dejó a la **OT 2798 figurando como "Realizado, 1 h"** con el registro de
   la 2796 — ver
   [el spec de las altas del sistema](2026-10-16-mantenimiento-altas-del-sistema-design.md).
2. **El formulario se va a apagar.** Es el paso 5 de
   [las planillas las llena el sistema](2026-10-19-las-planillas-las-llena-el-sistema-design.md),
   acordado el 19/10/2026. Trabajo con fecha de vencimiento.
3. **Tres preguntas más en un formulario que llena gente apurada en planta
   bajan la calidad de lo que ya entra.** El GUT lo contesta quien reparte el
   trabajo, no quien reporta la falla.

Se puntúa en dos lugares, los dos dentro del sistema:

- **Al crear la orden**, en `NuevaOTModal`: tres desplegables más. Hoy son 15
  órdenes, pero es el camino que va a crecer cuando el formulario se apague.
- **Sobre una orden que ya existe**, desde el listado y desde el detalle. Éste
  es el que importa hoy: es por donde entran las 2.209.

Se puede corregir siempre. Un puntaje no es una acción irreversible, así que
**no lleva llamada a `auditar()`** — la regla del núcleo es para lo que no se
deshace, y esto se deshace escribiendo otro número.

### Los otros dos caminos de alta: nadie hereda un puntaje

`NuevaOTModal` no es la única puerta. Hay dos más, y las dos ya arrastran la
`prioridad` de algún lado:

- **Aviso → OT** ([otDesdeAviso.ts](../../../lib/mantenimiento/otDesdeAviso.ts)),
  que hoy **deriva la prioridad sola** desde la urgencia del aviso, con
  `prioridadDeUrgencia()`.
- **Reutilizar OT** (`copiarDeLaOT` en
  [reutilizarOT.ts](../../../lib/mantenimiento/reutilizarOT.ts)), que copia la
  `prioridad` de la orden vieja a la nueva.

**Ninguno de los dos siembra ni copia el GUT.** Los dos formularios llevan los
tres desplegables, vacíos, y alguien los contesta.

La tentación de sembrar `gut_urgencia` desde la urgencia del aviso es fuerte
—parece gratis y parece correcto—, y es justamente lo que este diseño no quiere:
un número que nadie contestó pesando igual que uno que sí. La urgencia de un
aviso la puso quien reportó la falla; el GUT lo contesta quien reparte el
trabajo, y son dos personas distintas mirando dos cosas distintas.

En `copiarDeLaOT` el GUT va a la lista de lo que **no** se copió, que esa
función ya informa en castellano. Una orden nueva empieza sin puntaje aunque
sea la quinta vez que se cambian los mismos martillos: el puntaje depende de
cuándo es, no de qué es.

## Dónde se guarda, y por qué no en `prioridad`

Tres columnas nuevas en `ordenes_trabajo`, más una cuarta que es la clave de
orden:

```sql
alter table ordenes_trabajo
  add column gut_gravedad  smallint check (gut_gravedad  between 1 and 5),
  add column gut_urgencia  smallint check (gut_urgencia  between 1 and 5),
  add column gut_tendencia smallint check (gut_tendencia between 1 and 5),
  add column gut_orden integer generated always as (
    (case when estado in ('REALIZADO', 'SUSPENDIDA') then 0 else 1000 end)
    + coalesce(gut_gravedad * gut_urgencia * gut_tendencia, 27)
  ) stored;

create index ordenes_trabajo_gut_orden_idx
  on ordenes_trabajo (gut_orden desc, ot_number desc);
```

**El puntaje que se muestra no se guarda**: es el producto de las tres notas y
se calcula en TypeScript donde haga falta, y es `null` si falta alguna.

**`gut_orden` no es el puntaje y no hay que confundirlos.** Es una clave de
orden, y por eso se llama así. Lleva adentro las dos reglas de abajo —el 27 de
las que no tienen puntaje y el empujón de las que siguen abiertas— que son
decisiones de ordenamiento y no mediciones de nada. Si alguien la imprime en
pantalla, está mostrando el número equivocado.

Es una columna **generada**, no un derivado que mantenga la aplicación:
Postgres la recalcula en cada escritura y no puede quedar desfasada. La regla
de "un derivado guardado algún día miente" es para los que mantiene el código a
mano, y acá no aplica. Hace falta porque PostgREST sólo sabe ordenar por
columnas, no por expresiones, y el listado completo se pagina de a 50 — ordenar
en el cliente ordenaría nada más que la página que se está viendo.

La tentación evidente era escribir el resultado en `prioridad`, que ya existe y
ya se muestra. **No se puede, y es importante entender por qué antes de
proponerlo de nuevo:**

- `prioridad` es la **columna S** de la pestaña `OT`, que es parte del derrame
  de los `IMPORTRANGE`. Un `PUT` ahí bloquea el derrame (`#REF!`) o es pisado
  cuando recalcula.
- Aunque se pudiera escribir, la sincronización hace `upsert` por `ot_number`
  con los campos que lee de la planilla, así que **la próxima corrida la
  pisaría**.

Las columnas nuevas no tienen ese problema: el `upsert` de la sincronización
arma su payload desde `OrdenLeida` y nunca las nombra, así que `ON CONFLICT DO
UPDATE` no las toca. **El GUT sobrevive a cada sincronización.** Lo que sí se lo
lleva es el borrado de espejo: si la fila desaparece de la planilla, la orden se
borra y su puntaje con ella, que es lo correcto —la orden ya no existe.

### El GUT no viaja a la planilla

No se exporta a ninguna celda. Quien no entra al SdG no lo ve, y eso es un
**riesgo asumido**, no un olvido: exportarlo significaría escribir en el libro
que está por darse vuelta, y la regla de "toda ruta que toque un campo que se
exporta tiene que exportar" no aplica a un campo que no se exporta.

Cuando el paso 5 del vuelco esté hecho y el sistema sea el que llena la
planilla, esto se revisa. Hasta entonces el GUT vive sólo adentro.

## Una orden sin puntaje no se hunde

Es la trampa de este diseño y hay que verla de frente.

Si "sin puntaje" valiera cero, las 29 pendientes sin puntuar se irían al fondo
de la lista y **se quedarían ahí para siempre**, porque nadie mira el fondo de
una lista. El GUT habría empeorado exactamente lo que vino a arreglar.

**Una orden sin puntaje vale 27**, que es el centro de la escala (3 × 3 × 3).
Queda en el medio del pelotón: no se hunde, no se cuela arriba, y puntuarla la
puede mover para cualquiera de los dos lados. Es la misma decisión que ya tomó
`peso()` en `prioridad.ts` —"lo que no se reconoce queda en el medio"— y por los
mismos motivos.

El 27 está escrito dos veces y **tiene que estar escrito dos veces**: en el
`coalesce` de `gut_orden`, para el orden que hace la base, y en la función pura
de TypeScript, para el que hace el cliente. Es la clase de número que se cambia
en un lado y se olvida en el otro, así que va con un test que compruebe que los
dos órdenes dan lo mismo sobre el mismo conjunto.

En pantalla se distingue igual: la que no tiene puntaje muestra una raya y no un
número. Eso es lo que alimenta la sugerencia de más abajo.

## Dónde ordena el GUT

En las tres pantallas donde se mira o se elige trabajo. **No alcanza con
cambiar `ordenSugerido`**, y conviene entender por qué antes de empezar:
`ordenSugerido` y `aplicarOrdenManual` tienen **un solo consumidor en todo el
repo**, la pestaña "Qué hacer primero" de arrastrar y soltar — la misma que no
se usó ni una vez en 2.224 órdenes. Tocar sólo esa función es cambiarle el
orden a una pantalla que nadie abre.

### 1. El listado de órdenes, completo

Es el cambio que pidió el área y el único que necesita la base. La ruta
`app/api/mantenimiento/ordenes/route.ts` pasa a ordenar por `gut_orden`
descendente y después por `ot_number` descendente, en lugar de sólo por
`ot_number`. Como el listado se pagina de a 50 sobre 2.224 filas, esto **tiene**
que pasar en el servidor: ordenar en el cliente ordenaría la página y no la
lista.

Cuando el listado se filtra a pendientes la ruta ya devuelve hasta 300 de una
sola vez —hoy son 45—, así que ahí el orden llega completo igual.

### 2. "Qué hacer primero"

`ordenSugerido` pasa a ordenar así:

1. **Lo atrasado primero.** Sin cambios: ya se pasó de fecha, no importa con qué
   puntaje nació.
2. **Puntaje GUT, de mayor a menor** (sin puntaje = 27). Reemplaza al peso de
   ALTA/MEDIA/BAJA.
3. **La que espera hace más.** Sin cambios.

`aplicarOrdenManual` no se toca: lo que alguien puso a mano sigue ganándole a
todo. El orden manual es el juicio de quien reparte el trabajo y el GUT es una
sugerencia, no al revés.

### 3. "Agregar órdenes al plan"

El selector de la planificación diaria —`PlanDetalle.tsx`— es donde alguien
elige qué se hace mañana, y hoy no ordena por nada. Pasa a ofrecer las
pendientes en orden de puntaje.

Esto último es decisión mía y es la más fácil de sacar si sobra: el pedido fue
el listado. Lo agrego porque es la pantalla donde la decisión se toma de verdad,
y dejarla sin orden después de todo este trabajo sería raro.

### Lo cerrado va al final, y por eso `gut_orden` tiene un escalón

El listado no está filtrado por defecto: muestra las 2.224, y **2.179 están
realizadas**. Ordenar eso por puntaje a secas tiene una consecuencia que no se
ve hasta dentro de un año: una orden de 125 puntos que se hizo en diciembre de
2025 se queda **para siempre arriba de todo**, por encima de la que entró hoy.
Rankear por urgencia lo que ya se hizo no significa nada, y de paso entierra lo
nuevo.

Por eso `gut_orden` le suma 1000 a lo que sigue abierto. Las que esperan algo
van primero, ordenadas por puntaje entre ellas; las realizadas y las suspendidas
van después, también ordenadas por puntaje entre ellas. El escalón vive en la
columna generada y no en el código, así que vale igual para cualquiera que
ordene por ella.

### La prioridad de la planilla deja de ordenar

Queda como un dato más que se muestra donde ya se muestra. No se borra ni se
oculta: sigue entrando por la sincronización, sigue estando en los filtros y en
el detalle, y sigue siendo lo que lee quien mira la planilla.

### Las dos lecturas de `prioridad` que hay que tocar, y que ya estaban rotas

Hay dos lugares donde la prioridad no se muestra sino que **significa** algo, y
los dos tienen el mismo defecto: comparan `prioridad.toUpperCase()` contra
`"ALTA"`, cuando la planilla la guarda como `"🟠 Alta"`. **Ninguno de los dos
coincide nunca.** Es el mismo error que `soloLaPalabra()` arregló en
`prioridad.ts`, que quedó sin arreglar en estos dos.

- **La pastilla `alta`** de `OrdenarTrabajo.tsx`, dentro de la misma lista que
  el GUT va a ordenar. **Se saca.** No es "ocultar la prioridad de la planilla":
  esa pastilla **nunca se dibujó**, y de haber andado sería dos escalas diciendo
  "alta" a cinco píxeles de distancia. La prioridad sigue visible en el detalle
  y en los filtros, que es donde no compite con nada.
- **`resumirAtrasadas().urgentes`** de `alertas.ts`, que alimenta el "· N de
  prioridad alta" del tablero y hoy dice **siempre 0**. Pasa a contar las
  atrasadas con **puntaje GUT de 65 o más**, y la leyenda cambia a decirlo. Es
  el único número del tablero que este trabajo toca.

Arreglar la comparación en vez de cambiar la fuente dejaría al tablero contando
una columna que el 92,3% de las órdenes no tiene. El GUT es la escala que ahora
significa algo; que el tablero cuente ésa.

## Cómo se ve: el número y el color, sin palabras

El puntaje se muestra como un recuadro chico con **el número** y un color de
fondo según su banda. Al pasar por encima dice las tres notas: `G4 · U5 · T4`.

**No lleva palabra.** Ésta es una decisión deliberada: las palabras obvias
—alta, media, baja— son exactamente las que ya usa la columna `prioridad` de la
planilla. Dos escalas distintas con las mismas tres palabras conviviendo en la
misma pantalla es cómo se consigue que alguien lea una y decida por la otra. El
número no se confunde con nada.

### Las bandas, cerradas

El material de origen las da con agujeros: `>79`, `79>GUT>64`, `63>GUT>27`,
`26>GUT>10`, `9>GUT>1`. Un puntaje de 64, de 27, de 10 o de 1 no cae en ninguna
—y 64 y 27 son productos perfectamente posibles (4×4×4, 3×3×3)—. Se cierran así,
sin solaparse y sin dejar hueco:

| Puntaje | Intensidad |
|---|---|
| 80 – 125 | la más fuerte |
| 65 – 79 | fuerte |
| 28 – 64 | media |
| 11 – 27 | suave |
| 1 – 10 | la más suave |

**Y el color no es el semáforo del material de origen.** El original pinta las
cinco bandas rojo, naranja, amarillo, verde y azul. En esta pantalla eso no se
puede: las pastillas de estado que van en la misma fila ya usan **rojo para
atrasado, ámbar para por hacer, azul para en proceso y verde para realizado**.
Un GUT bajo quedaría con un recuadro verde al lado de una pastilla donde verde
quiere decir "terminado", y uno de 5 con azul al lado de donde azul quiere decir
"en proceso".

Sería el anti-objetivo de este documento —dos escalas que significan cosas
distintas— colándose por el color después de haberlo cerrado en las palabras.
Así que la banda se pinta con **un solo tono, en cinco intensidades**, en un
color que no sea ninguno de los cuatro de estado. Se lee como un volumen y no
como un estado. Cuál tono exactamente es del que construya.

**La tabla de plazos del material no se usa.** El original convierte cada banda
en un tiempo de respuesta (inmediato, 2, 7, 15, 30 días). Se dejó afuera a
propósito: hoy una orden está atrasada si se le pasó la `proxima_fecha` o si la
planilla la marcó `ATRASADO`, y un plazo calculado por el sistema sería una
tercera forma de estar atrasada que nadie cargó y que terminaría en la campana y
en el push de las 8:30. Por ahora el puntaje es un número que ordena. Los plazos
se pueden agregar después, y entonces es una decisión aparte con su propio
riesgo.

## La sugerencia es una línea en pantalla, no una notificación

En la pantalla de órdenes, cuando hay pendientes sin puntuar, aparece una línea
discreta: *"29 de las 45 pendientes no tienen GUT"*, con un acceso para
puntuarlas.

**No es un aviso de `lib/home/avisos.ts`**, y por lo tanto no va a la campana ni
al push. El motivo está medido en el proyecto: un aviso cuyo número no se mueve
dice lo mismo todos los días hasta que alguien lo descarta para siempre, y las
dos únicas personas que probaron las notificaciones en serio tenían los trece
avisos descartados. Un contador de órdenes sin puntuar es justo esa clase de
número.

El pedido textual fue *"que a lo sumo te sugiera aplicarlo a la que no lo
tenga"*. Una línea en la pantalla donde la persona ya está parada es el techo de
ese "a lo sumo".

## Lo que esto no hace

- **No toca el formulario de Google**, ni sus preguntas ni sus columnas.
- **No escribe en ninguna planilla.**
- **No fija plazos ni fechas**, y no crea una nueva manera de estar atrasado.
- **No le pone GUT a los equipos.** Se evaluó y se descartó: el método es para
  tareas, y `equipos.criticality` —que hoy tiene 238 de 239 equipos en "MEDIA"
  por el valor por defecto del importador— es otro problema, con otra solución.
- **No reemplaza el orden manual**, que sigue ganando.
- **No borra ni oculta la prioridad de la planilla.**

Y dos que son anti-objetivos, o sea: si pasan, esto salió mal aunque funcione.

- **Que una orden sin puntuar desaparezca al fondo de la lista.**
- **Que convivan dos escalas que dicen "alta" y "media" y signifiquen cosas
  distintas.**

## Qué queda para quien construya

- La migración (las tres columnas, `gut_orden` y su índice), que **la aplica una
  persona a mano** en el editor SQL de Supabase. Mientras no esté aplicada no
  hay nada que probar contra la base, así que el trabajo queda a la espera.
- El cambio de orden en `app/api/mantenimiento/ordenes/route.ts`: `gut_orden`
  descendente y después `ot_number` descendente.
- `lib/mantenimiento/gut.ts` con las funciones puras: el puntaje, la banda, y
  las etiquetas de las tres escalas. Es lo que se testea.
- El cambio en `ordenSugerido`, con sus tests —incluido uno que fije que la
  orden sin puntaje queda en el medio y no al fondo.
- La ruta que guarda las tres notas, con `validar()` de `lib/core/validar.ts`:
  enteros de 1 a 5 o nulos. Permiso: `puedeEditarMantenimiento()`, el mismo que
  el resto de la edición de órdenes.
- Los tres desplegables, con `<Select>` y no `<select>` nativo.
- Dónde exactamente cae el recuadro del puntaje en el listado y en el detalle, y
  cómo entra la sugerencia en la pantalla sin desordenarla.
- Que la grilla de los tres desplegables lleve `grid-cols-1 sm:grid-cols-3`: en
  343 px de ancho útil, tres columnas quedan en 114 px y ahí no entra una
  etiqueta con su campo.

## Cómo se verifica

Lo de siempre —`npm test`, `npx tsc --noEmit`, `npm run build`,
`node scripts/revisar-arbol-commiteado.mjs`, `node scripts/revisar-responsive.mjs`—
y una comprobación propia que no hacen los anteriores:

**Puntuar una orden, correr la sincronización de órdenes, y volver a leerla.**
Las tres notas tienen que seguir ahí. Es la única manera de comprobar que el
`upsert` por `ot_number` no las pisa, y es la clase de supuesto que en este
módulo ya salió mal antes.

Dos más que dependen de la columna generada, y que sólo se pueden hacer con la
migración ya aplicada:

- **Cerrar una orden puntuada y mirar su `gut_orden`.** Tiene que caer 1000 de
  golpe, sin que nadie escriba esa columna. Si no cae, el escalón no está
  andando y las realizadas se van a quedar arriba.
- **Pedir el listado completo por la ruta y comprobar que la primera página
  trae las de puntaje más alto**, y no las de número de OT más alto. Es lo
  único que distingue "ordené en el servidor" de "ordené la página que estaba
  viendo", que es el error que este diseño existe para no cometer.
