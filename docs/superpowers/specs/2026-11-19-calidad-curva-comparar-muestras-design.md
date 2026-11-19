# Varias muestras en la misma curva

La pantalla de la curva granulométrica (`/calidad/ensayos/curva`) dibuja hoy
**una** muestra. Esto la deja elegir **varias y superponerlas**, en los tres
gráficos y en el Excel.

Acordado el 19/11/2026. El pedido fue de una línea —«que se pueda elegir más de
una muestra, para poder compararlas»— y, preguntado qué quería poder decir
mirando dos curvas juntas, el usuario contestó «Avanza». **Así que todo lo que
sigue lo decidió quien redactó esto**, y está escrito para poder discutirlo, no
porque se haya acordado.

## Para qué existe

Una curva sola dice cómo salió una molienda. Dos o más dicen si se está
moviendo, y en qué extremo: si el material se está yendo a fino, si una partida
se parece a la anterior, si lo que se le manda a un cliente es lo mismo que se
le manda a otro.

## Lo que se midió antes de decidir nada

Contra la base de producción, el 19/11/2026: **106 muestras con granulometría**
en 8 productos. Lo que importa:

| Producto | Muestras | Juegos de mallas distintos |
|---|---|---|
| Filler 2 | 23 | 2 — 17 con `#20,50,100,200`, 6 con `#50,100,200,325` |
| Calcio 0-2 | 21 | 1 |
| Filler 1 | 21 | **3** — 16, 4 y 1 |
| Cal | 19 | 2 |
| Despacho a Kartonsec | 10 | 2 |
| Despacho a Emapi | 8 | 1 |
| Calcio 0-1 | 2 | 1 |
| Calcio #200 | 2 | 1 |

**Las muestras del mismo producto no siempre miden los mismos tamices**, y no es
un caso raro: pasa en **4 de los 8 productos**. Dos Filler 1 cualesquiera tienen
buena chance de cruzar una que midió `#20` con otra que midió `#325`. Eso es lo
que obliga a decidir qué hace el eje X, que hoy son «las mallas que midió *esta*
muestra» y con dos muestras deja de alcanzar.

El otro número que decide algo: **23 muestras en el producto más cargado**.
Superponerlas todas es una pantalla ilegible.

## Lo que se decidió

### El eje X es la unión, y lo que falta queda como hueco

El eje son **todas las mallas que midió alguna de las muestras elegidas**, en
orden. Una muestra que no midió una de esas mallas **no aporta punto ahí: su
línea se corta y sigue después**. No se interpola y no se pone cero.

Las otras dos salidas se descartaron por lo que inventan:

- **Interpolar** dibuja un punto en una malla que esa muestra no tamizó, con el
  mismo aspecto que los medidos. Es la regla de todo el sistema: enlazar al que
  se le parece es peor que dejar en null.
- **Poner cero** dice «no quedó nada retenido ahí», que es una medición, y
  además una falsa: en el acumulado llevaría la curva a bajar.
- **Cortar el eje a la intersección** —sólo las mallas que midieron todas—
  esconde mediciones reales: con un Filler 1 de cada juego, la intersección es
  `#50,100,200` y se perderían `#20` y `#325`, que son justamente los extremos
  donde se ve si el material se fue a grueso o a fino.

En la práctica los huecos caen en las puntas y no en el medio —lo que varía es
si se midió `#20` arriba o `#325` abajo—, así que una línea que no llega al
borde es lo normal, no una rareza.

### Y se dice cuál muestra no midió qué

Debajo de los gráficos, una línea que lo nombra, **sólo cuando las muestras
elegidas no midieron todas lo mismo**.

**Esto da vuelta a medias la decisión del 05/11**, que dijo que la pantalla no
avisa de las mallas que faltan, y conviene decir por qué no es una contradicción:
allá la malla faltante salía de **lo que declara el producto**, un dato que la
pantalla ni siquiera recibe, y avisar habría sido traer una tercera cosa a la
discusión. Acá la malla está en el eje porque **la midió otra muestra que está
en el mismo gráfico**: es visible, y una línea que se corta sin explicación se
lee como un error del sistema. Sigue sin avisarse de las mallas que el producto
declara y nadie midió.

### Hasta seis muestras

Un tope de **6**. Dos razones, las dos medidas: el producto más cargado tiene 23
muestras y superponerlas es ruido; y seis es lo que una paleta distingue de
verdad **impresa en blanco y negro o en una fotocopia**, que es donde termina el
Excel. Al llegar al tope, el selector lo dice en vez de ignorar el clic.

### Se pueden cruzar productos, y sale del mismo mecanismo

El selector de producto **filtra la lista de muestras disponibles**; las
muestras ya elegidas **se quedan aunque se cambie de producto**. Así, armar un
conjunto de un solo producto es el camino natural, y comparar Filler 1 contra
Filler 2 —o Emapi contra Kartonsec, que parecen el mismo material a dos
clientes— sale sin ninguna pantalla de más.

El eje Y es porcentaje del peso tamizado, así que no hay unidades que no se
puedan comparar entre productos.

**La etiqueta de cada muestra lleva el producto sólo cuando el conjunto cruza más
de uno.** Con un solo producto el nombre repetido seis veces no distingue nada.

### Los tamices que se apagan siguen siendo uno para todos

Los chips son la unión del eje, y apagar uno lo saca **de las tres curvas y de
todas las muestras**. Es lo que ya hacía con una, y la razón para apagarlo
—«ese tamiz se tamizó mal»— es del tamiz y no de la muestra.

La nota del acumulado no cambia y sigue siendo necesaria: apagar un tamiz no
recalcula nada, en ninguna de las curvas.

### El Excel va en formato largo: una fila por muestra y malla

La tabla pasa a tener **una fila por cada par (muestra, malla)**, con la muestra
como primera columna, en vez de una columna por muestra.

El motivo es el mismo hueco de arriba. **En formato ancho, una malla que una
muestra no midió es una celda vacía al lado de números reales, y una celda vacía
en una planilla se lee como cero** — justo lo que la pantalla se cuidó de no
dibujar. En formato largo esa fila sencillamente no existe, que es lo que pasó.
Y de paso no se ensancha: con seis muestras el ancho es el mismo que con una.

La hoja queda así: un bloque con una fila por muestra (producto, fecha, peso
tamizado, observaciones), la tabla larga, y abajo las notas y los problemas,
cada uno diciendo de qué muestra habla cuando hay más de una.

Las tres fotos de los gráficos siguen yendo a la derecha de la tabla, como hoy.

### La URL acepta las dos formas

`?muestras=id1,id2,…` es la nueva. **`?muestra=id` se sigue aceptando**, porque
ya hay enlaces de una muestra sola dando vueltas y romperlos no tiene ninguna
ventaja. `?producto=` queda como lo que es: el filtro del selector.

## Lo que queda afuera

- **Un promedio, una banda o una envolvente** de las muestras elegidas. Es otra
  cosa y pide decidir qué se promedia cuando los juegos de mallas difieren.
- **Dibujar los límites del producto.** Hay 2 cargados en todo el sistema y uno
  solo es granulométrico; ya se descartó el 05/11 y vale igual acá.
- **Elegir muestras por rango de fechas o «las últimas N».** Se eligen a mano.
- **Guardar un conjunto de comparación.** El enlace es el que guarda.
- **Que la comparación invente o corrija un número.** Es lo que está cargado.

## Restricciones, que son las del repo

- Todo en **castellano**.
- **Sin migración.** Nada de esto guarda nada.
- **`<Select>` y no `<select>`**, y nada de `w-*`, `text-*` ni `border-*` pegado
  a `.input`, `.card` o `.btn-*`.
- `grid-cols-1 sm:grid-cols-N`: el ancho útil del teléfono es 343 px.
- Los tests van sobre **funciones puras en `lib/`**: el armado del eje unido y
  las filas de la hoja son puros y se prueban; la pantalla y la ruta no se
  testean.
- La ruta del Excel sigue leyendo **los números de la base** y aceptando del
  cliente sólo los tamices apagados, los ids y las imágenes.
- **`.in()` con muchos ids rompe la URL de PostgREST**: con el tope de 6 no es
  un problema, pero la lectura va de a una muestra como hoy.

## Lo que decide quien lo construya

- La paleta exacta de los seis colores y el orden en que se asignan.
- Cómo se ve el selector de varias muestras (lista con tildes, chips que se
  sacan, o `MultiSelect` si encaja) y dónde va el cartel del tope.
- El texto exacto de la línea que nombra las mallas disparejas.
- Si la leyenda va arriba o abajo de cada gráfico, y qué pasa con el alto en el
  teléfono cuando son seis entradas.
- El orden de las filas de la tabla larga: por muestra y después por malla, o al
  revés.
