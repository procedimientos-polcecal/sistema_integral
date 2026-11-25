# La curva se baja como imagen, y las muestras dejan de tener tope

**Fecha**: 25/11/2026
**Módulo**: Calidad — Ensayos, la curva granulométrica (`/calidad/ensayos/curva`)

Dos pedidos del usuario, el mismo día:

1. que los gráficos se puedan **bajar como imagen directamente**, sin pasar por
   el Excel;
2. que **no haya tope** para cuántas muestras se comparan.

Son dos features chicas y una de ellas da vuelta una decisión medida el
19/11/2026, así que lo que sigue es sobre todo el porqué de esa vuelta.

## 1. Bajar un gráfico como imagen

Hoy la única forma de sacar el dibujo es **bajar el Excel**, que lleva la tabla
y las tres fotos. Quien quiere pegar una curva en un correo baja una planilla de
siete columnas y recorta la imagen de adentro.

La rasterización ya existe y está probada en producción: el botón del Excel
fotografía cada panel con `html2canvas` a `scale: 4` y manda los tres PNG a la
ruta. Bajar la imagen es **el mismo camino cortado un paso antes**: en vez de
mandarla al servidor, se la entrega al navegador.

Decisiones:

- **Un botón por gráfico, no uno que baje los tres.** Tres descargas
  simultáneas las bloquea el navegador, y un `.zip` obliga a descomprimir para
  pegar una imagen en un correo. Quien quiera los tres aprieta tres veces.
- **También se baja desde la vista ampliada, y ésa es la que conviene.** En la
  grilla el panel mide ~287 px y la leyenda va cortada en 26 caracteres; en el
  modal hay 1152 px y las etiquetas salen enteras. El `scale: 4` sube la
  densidad en los dos casos, pero no desenvuelve un rótulo cortado.
- **Los dos botones llevan `data-html2canvas-ignore`**, igual que el de
  ampliar: un control de la pantalla dentro de la foto es un cuadrito gris que
  nadie puede apretar.
- **La misma guarda que el Excel.** Si recharts todavía no dibujó —no hay
  `svg.recharts-surface`— la foto sale gris y válida, indistinguible de un
  gráfico vacío. Se comprueba antes de rasterizar, y el mensaje es el mismo.
- **Y el modal necesita un `onclone`, que es lo que se encontró leyendo el
  paquete en vez de suponiendo.** `html2canvas` clona el documento en un
  iframe y respeta el `overflow` de los ancestros al pintar; el cuerpo del
  `Modal` es `overflow-y-auto` con `max-h-full`, así que un gráfico ampliado
  más alto que la pantalla —lo que pasa en cuanto la leyenda ocupa dos
  renglones, o sea justo en el caso que esto viene a habilitar— saldría
  cortado por abajo **y sin que nada avise**. `onclone(documentClone,
  referenceElement)` corre antes de que se midan los límites del nodo, así que
  el recorte se suelta ahí, en el clon y nunca en la pantalla.

El nombre del archivo lo arma la misma función que el del Excel
(`lib/calidad/ensayos/nombreDelArchivo.ts`, mudada desde la ruta): con una
muestra, producto y fecha; con varias, cuántas son y el día de hoy. Lo que
cambia es la extensión y que la imagen nombra además qué gráfico es.

## 2. Sin tope de muestras

### Por qué había seis, y por qué ya no

El tope de seis tenía dos razones escritas, y **las dos eran sobre lo que se
ve, no sobre lo que el sistema aguanta**:

- superponer las 23 muestras del producto más cargado es ruido;
- seis es lo que la paleta distingue impresa en gris.

La segunda es la que importa, y la medición que la sostiene sigue siendo
cierta: una línea tiene que verse contra el blanco, lo que la deja por debajo
de 0,37 de luminancia, y seis valores en esa banda no pasan de ~1,2 de
contraste entre sí. **El color no separa en papel; separa el trazo.**

Lo que estaba mal era la conclusión. Color y trazo se indexaban **los dos con
`i % 6`**, así que la séptima curva repetía el par entero de la primera —verde
y línea llena— y eso ponía el techo en seis. Pero son **dos ejes**: seis
colores por seis trazos son **36 combinaciones**, y alcanza con recorrer el
segundo eje una vuelta más tarde que el primero.

El par de la serie `i` pasa a ser:

```
color = COLORES[i % 6]
trazo = TRAZOS[(i + floor(i / 6)) % 6]
```

Dos series chocan sólo si coinciden en `i % 6` **y** en `floor(i / 6) % 6`, o
sea si `i ≡ j (mod 36)`. Y la propiedad que hace que esto no sea un cambio de
aspecto: **para `i` de 0 a 5 el término de la vuelta es 0**, así que las
primeras seis curvas quedan **exactamente como estaban** —el verde con línea
llena primero, para que una muestra sola se siga viendo como antes de que la
comparación existiera—.

### Lo que el techo pasa a ser

**No queda ningún tope de producto.** El que queda es un techo técnico de
**200 ids**, que es lo que entra en un `.in()` de PostgREST sin armar una URL
que rechace con un 400. No es una opinión sobre cuántas curvas se leen: es
cuántos ids acepta una consulta.

Y hace falta que sea técnico y no un número un poco más alto, porque **esto
crece rápido**. Medido contra producción:

| | 19/11/2026 | 25/11/2026 |
|---|---|---|
| Muestras con granulometría | 106 | **135** |
| Productos con granulometría | 8 | **11** |
| El producto más cargado | 23 (Filler 1) | **28 (Filler 2)** |

O sea ~1 muestra por día en el producto más cargado. Un tope de 40 se alcanza
en dos semanas y el usuario vuelve a pedir lo mismo.

### Las consecuencias que hay que mirar

**Leer 200 muestras de a una son 400 consultas.** La pantalla y la ruta traían
cada muestra con su propio `traerMuestra` —dos consultas cada una— con el
argumento, escrito, de que «son seis como mucho por el tope». Sacado el tope,
ese argumento se cae: pasa a haber **un `traerMuestras` por lote**, una
consulta para las muestras y otra para sus retenidos.

**Y un id mal formado deja de ser inofensivo.** Mientras las muestras se traían
de a una, un id cualquiera hacía una consulta que no encontraba nada y la
pantalla salteaba *esa* muestra; `leerMuestrasPedidas` lo decía y no validaba la
forma. Con un solo `.in()` eso cambia de categoría: Postgres rechaza la consulta
entera con un `22P02` y no vuelve **ninguna**, así que un enlace de tres
muestras al que el chat le truncó el último id abre la pantalla vacía, sin un
solo mensaje. Medido contra producción el 25/11/2026. Por eso
`leerMuestrasPedidas` pasa a tirar lo que no tiene forma de UUID —la misma
expresión que ya validaba la ruta del Excel— y el salteo sigue valiendo para lo
que sí es un caso real: un uuid válido de una muestra borrada.

**Y los retenidos de 200 muestras pasan de mil filas.** Medido hoy: 660
renglones para 135 muestras, 4,9 mallas por muestra de promedio y 8 como
máximo. Doscientas muestras dan entre 980 y 1.600 renglones, y PostgREST corta
en 1.000 **sin avisar**: esa lectura va por `traerTodo()`, y su `order` lleva
`muestra_id` además de `malla` para que la paginación sea determinista.

**La leyenda se muda afuera del gráfico.** Hoy la dibuja recharts adentro del
área del `LineChart`, que mide `h-64` fijo: con ocho entradas o más la leyenda
se come el dibujo hasta dejarlo en nada, y en un teléfono lo tapa. Pasa a ser
markup propio **debajo del gráfico y dentro del panel**, para que siga entrando
en la foto del Excel y en la imagen que ahora se baja. Dos cosas que vienen de
regalo: el dibujo recupera su alto entero, y la muestra del color **lleva su
trazo**, que es lo que de verdad la distingue en papel.

### Lo que no se hace

- **No se avisa de que hay muchas curvas.** Doce superpuestas se leen con
  esfuerzo y eso lo ve quien mira; un cartel que lo diga es opinión del sistema
  sobre el trabajo de quien compara. Lo que **sí** se dice es el único hecho:
  pasadas las 36, el par de color y trazo se repite y dos curvas quedan
  idénticas. Ese cartel aparece recién ahí.
- **No se agrega un «elegir todas».** Llegar a 28 muestras pide 28 clics, y eso
  es un freno natural que no cuesta nada mantener.
- **El tooltip sigue listando todas las series de esa malla.** Con veinte
  muestras es una caja alta. Se deja así: recortarlo escondería justo la
  comparación que alguien pidió.

## Lo que no se pudo comprobar

Lo de siempre en este módulo: **está todo detrás del login**. Nadie abrió la
pantalla con una sesión real ni bajó un PNG. Lo que se probó son las funciones
puras —el par de cada serie, el techo de ids, el nombre del archivo— y los
tipos y el build. La primera corrida real conviene hacerla con Filler 2, que es
el que tiene 28 muestras.
