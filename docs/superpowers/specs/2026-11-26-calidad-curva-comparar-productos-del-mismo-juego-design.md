# Comparar productos distintos, los que tengan el mismo juego de tamices

**Fecha**: 26/11/2026
**Módulo**: Calidad — Ensayos, la curva granulométrica (`/calidad/ensayos/curva`)

Lo pidió el usuario así: *«que se puedan comparar distintos productos, de los
que tengan el mismo juego de tamices. por ej yo quiero comparar arena de
chocolata con arena de caliza»*.

## Lo primero: cruzar productos ya se podía

Desde el 19/11/2026 los chips sobreviven al cambio de producto, y la propia
pantalla lo dice en su bajada: «Se pueden mezclar productos». Elegir Arena
Chocolata, aplicar, cambiar a Arena caliza LN y aplicar de nuevo deja las seis
curvas superpuestas, y así funciona hoy.

**Lo que no había era cómo encontrar con qué producto vale la pena.** El
selector muestra uno por vez, el catálogo tiene 23 productos y nada en pantalla
dice cuáles miden los mismos tamices. Quien no lo sabe de memoria tiene que
probar.

Así que esto no agrega una capacidad: **agrega el camino para usar la que ya
estaba**, y lo acota como se pidió.

## La decisión que gobierna todo: declarado, no medido

Un producto **declara** un juego (`calidad_ensayos_productos.mallas`, que es lo
que la pantalla de carga propone), y cada muestra **mide** el que midió. No son
lo mismo. Medido contra producción el 26/11/2026, sobre 23 productos y 145
muestras con granulometría:

| | juegos distintos |
|---|---|
| Declarado, entre los 12 productos que declaran algo | **2** — `20·50·100·200` y `6·7·10·12·20·50·100·200`, seis productos cada uno |
| Medido, entre las 145 muestras | **5** |

Y el detalle que decide: **Filler 1 midió tres juegos distintos** (23 muestras
en `20·50·100·200`, 4 en `50·100·200·325`, 1 en `50·100·200`). Filler 2, Cal y
Despacho a Kartonsec tienen dos cada uno.

Agrupar por lo medido pondría a Filler 1 en tres grupos a la vez, que no es un
criterio sino un ruido. Y lo que se perdería agrupando por lo declarado ya está
resuelto desde el 19/11: **el eje de la curva es la unión**, la malla que una
muestra no midió queda en `null` con `connectNulls={false}`, y el hueco se
nombra debajo de los gráficos. O sea que una muestra con un tamiz de más o de
menos se dibuja bien y lo dice.

**El juego vacío no empareja con nadie.** 11 de los 23 productos no declaran
mallas —y hoy ninguno de esos tiene muestras con granulometría, así que no se
pierde nada—. Juntarlos sería emparejar «Caliza galpón» con «Acopio» por lo
único que tienen en común, que es no haber dicho nada: la regla de la casa,
enlazar al que se le parece es peor que dejar en null.

El criterio vive en `lib/calidad/ensayos/juegoDeTamices.ts` (`losQueComparten`),
con sus tests.

## Lo que se ve

El selector de muestras del producto gana **una casilla debajo**:

> ☐ Sumar los otros 4 productos con el mismo juego de tamices
> (6 · 7 · 10 · 12 · 20 · 50 · 100 · 200): Calcio 0-1, Calcio 0-2, Arena
> Lourdes, Arena caliza LN

Prendida, el `MultiSelect` lista también las muestras de esos productos, con el
nombre del producto adelante en cada etiqueta. El resto no cambia: se tilda lo
que haga falta y se aplica con «Comparar».

Para el caso que se pidió —Arena Chocolata—, la casilla suma **34 muestras de 4
productos**, Arena caliza LN entre ellos.

Decisiones:

- **Arranca prendida si lo elegido ya cruza el grupo.** Quien abre un enlace
  compartido de dos productos tiene que ver las dos listas: si no, el selector
  diría una cosa y los chips otra.
- **No vive en la URL.** Lo que se comparte es qué muestras se comparan, nunca
  cómo se llegó a elegirlas — y al volver se deduce sola de la regla de arriba.
- **Sólo se nombran los productos del grupo que tienen alguna muestra.** Calcio
  1-2 declara el juego grueso y tiene cero: nombrarlo promete una curva que no
  existe.
- **El nombre del producto entra en la etiqueta sólo cuando hay más de uno a la
  vista.** Es `etiquetasDeMuestras(…, conProducto)`, la misma pregunta que ya se
  hacen los chips y la leyenda; con un producto solo repetiría su nombre en cada
  renglón.
- **Prender la casilla no es tildar.** Lo que ya se veía conserva lo que la
  persona decidió —si destildó algo sin aplicar, abrir el grupo no se lo
  devuelve— y lo que aparece recién arranca de lo que ya está elegido. Eso es
  `losTildesQueSiguen`, con sus tests.
- **El grupo entero se lee siempre, y la casilla no dispara una consulta.** El
  grupo más grande son 108 muestras de tres columnas (`Calcio #200`: 2 propias y
  106 del resto), y una segunda vuelta al servidor por prender una casilla se
  nota más que esas filas. Es una sola consulta con un `.in()` de hasta seis
  ids.

## Lo que no se hace

- **El desplegable de productos no se agrupa ni se filtra por juego.** Elegir un
  producto sigue siendo elegir cualquiera de los 23; lo que se acota es qué
  muestras ofrece el selector de abajo. Filtrar el catálogo escondería productos
  por una propiedad que tres de cada cinco no declaran.
- **Nada impide seguir cruzando juegos distintos a mano**, producto por
  producto, como se hacía hasta hoy: el eje sigue siendo la unión y el hueco
  sigue nombrándose. La casilla propone, no restringe.
- **El grupo no mira lo medido.** Un producto cuyas muestras midieron otro juego
  igual entra al grupo de lo que declara, y su curva lo muestra sola.

## Lo que no se pudo comprobar

Lo de siempre en este módulo: **está todo detrás del login**, así que la
pantalla no se abrió con una sesión real y la casilla no la tildó nadie. Lo que
se probó son las funciones puras, los tipos y el build.

Lo que sí se midió contra producción es qué ofrecería la pantalla, con
`npx tsx scripts/que-ofrece-el-selector-de-la-curva.mts`: imprime, por producto,
sus muestras, lo que declara, los juegos que midió de verdad cuando son más de
uno, y qué suma la casilla. La primera corrida real conviene hacerla con Arena
Chocolata, que es el caso que se pidió.
