# El pasante, y la curva que se pega en un informe

Dos cosas sobre la pantalla de la curva granulométrica (`/calidad/ensayos/curva`,
acordada el 05/11/2026): **un tercer gráfico, el pasante**, y **una descarga en
`.xlsx` con la tabla de la muestra y una imagen de los gráficos**, para pegar en
un informe.

Acordado el 11/11/2026.

## Para qué existe

**El pasante** es la curva granulométrica como la lee el laboratorio y como se
compara contra una especificación: cuánto material **pasó** cada tamiz. Hoy la
pantalla muestra el retenido de cada malla y el acumulado retenido, y las dos
contestan la pregunta por el otro lado.

**La exportación** existe por un uso concreto: alguien está escribiendo un
informe —a un cliente, a la dirección— y necesita la curva de una muestra
adentro de ese documento, junto a los números con los que se dibujó.

## Lo que se decidió

### El pasante es un gráfico aparte, no una línea más

Esto se preguntó explícitamente y la respuesta fue «agregar esa gráfica, no
sumar la línea a la otra». Importa porque **el pasante es el espejo exacto del
acumulado**: `granulometria()` calcula el acumulado como `corrido / peso × 100`,
así que el pasante es `100 − acumulado` punto por punto, y superpuestos serían
la misma línea dada vuelta — donde uno sube, el otro baja lo mismo.

En paneles separados eso no es redundancia sino las dos lecturas habituales del
mismo ensayo, que es como las muestra una planilla de laboratorio. Quedan **tres
gráficos** de la misma muestra, con **una sola selección de tamices** para los
tres: apagar `#20` lo apaga en los tres.

El pasante se calcula **donde ya se calculan los otros dos** y no en la pantalla.

### El Excel lleva una foto, y eso se eligió sabiendo lo que cuesta

Se evaluaron tres formas y la decisión salió de para qué es el archivo:

- **Una imagen del gráfico pegada sobre la tabla.** Se ve igual que en pantalla y
  se pega en un informe tal cual. Es una foto: si alguien corrige un número de la
  tabla, el dibujo sigue mostrando el anterior y nada avisa.
- **Sólo la tabla**, para que Excel dibuje su propio gráfico, vivo y atado a las
  celdas.
- **Un gráfico nativo de Excel escrito por nosotros.** Medido sobre el `exceljs`
  que tiene el repo: **no tiene ninguna API de gráficos** —`chart` no aparece una
  sola vez en sus tipos—, así que habría que escribir el XML a mano o cambiar de
  librería.

Se eligió **la imagen**, porque el archivo va a un informe ya escrito y no a
seguir trabajando los números. El riesgo —que la foto y la tabla se separen si
alguien edita— queda asumido y es la contracara de que se pegue sin trabajo.

`exceljs` **sí** sabe insertar imágenes (`addImage`).

### Se abre con Excel de escritorio, y de eso depende todo

Preguntado y contestado: **Excel de escritorio**. Importa porque el diseño entero
se apoya en que la imagen viaje pegada sobre la tabla, y **Google Sheets puede
descartar las imágenes flotantes al importar un `.xlsx`**, sin avisar. En Sheets
el archivo llegaría sin el gráfico, que es el único motivo por el que se hace
así.

Queda anotado como la condición que sostiene la decisión: **si algún día esto se
abre en Sheets, hay que comprobarlo antes de prometer que el gráfico llega.** No
se verificó contra Sheets porque no hace falta hoy.

### La hoja no avisa de las mallas que faltan, igual que la pantalla

El diseño del 05/11 decidió que la pantalla **no** avise cuando a una muestra le
falta una malla que su producto declara, a diferencia de `acumuladosDelListado()`.
Se volvió a preguntar ahora, porque el argumento que hizo viajar la nota del
acumulado —que el dato se va lejos de la pantalla que lo explicaba— vale igual
para esto, y porque pasa en **19 de 79 muestras**.

La respuesta fue **dejarlo como en la pantalla**. Así que el archivo tampoco lo
dice, y el producto ni siquiera necesita mandar sus mallas declaradas al cliente:
hoy `CurvaClient` recibe `{id, nombre}` y sigue así.

### La fila del tamiz apagado va, marcada

La tabla lleva **todas** las mallas que midió la muestra, incluidas las apagadas,
y las apagadas se marcan. Las otras dos opciones se descartaron por lo que
esconden: sacarlas deja un Excel donde no hay rastro de que esa malla se midió,
y dejarlas sin marcar produce un informe con una fila que el dibujo no tiene y
nadie sabe por qué.

Y **la nota del acumulado viaja en la hoja**, no sólo en la pantalla: que las
mallas que siguen a una apagada **ya incluyen** lo que ésa retuvo. Es el riesgo
que el diseño del 05/11 dejó asumido —con `Calcio 0-2` del 27/10, el 41,6 % de
`#50` contiene el 6,0 % de `#20`— y a partir de ahora se va a ir en un archivo,
lejos de la pantalla que lo explicaba.

## Cómo se hace, y qué decidió quién

**La decisión de abajo la tomó quien redactó esto, no la conversación.** Está acá
para poder discutirla.

Las diez descargas que ya tiene el sistema usan `xlsxResponse(archivo, hoja,
filas)` de `lib/core/xlsxExport.ts`, que escribe **sólo filas, desde el
servidor**. Ésta necesita una imagen, y recharts dibuja **SVG en el navegador**:
el servidor no tiene el dibujo.

Se decidió que **el navegador rasterice el SVG a PNG y lo mande a una ruta
nueva**, que arma el `.xlsx`. La alternativa —armar el archivo entero en el
navegador— mete `exceljs`, que pesa cerca de un mega, en el bundle de una
pantalla sola, cuando hoy vive únicamente del lado del servidor.

**La tercera vía se evaluó y no existe, y está medido.** La idea era dibujar el
gráfico en el servidor con `renderToStaticMarkup` y convertirlo con `sharp`, lo
que ahorraría la subida entera. Probado contra el recharts del repo (3.10): sale
**un `<div class="recharts-wrapper">` vacío de 127 caracteres, sin una sola línea
de SVG**, porque recharts dibuja en un efecto del lado del cliente. Y `sharp`
está en `devDependencies`, así que tampoco estaría garantizado en producción.
Hacerlo del lado del servidor pediría un navegador sin cabeza o un jsdom, que es
mucho más caro que la subida.

Eso implica una extensión chica de `lib/core/excel.ts` o de `xlsxExport.ts`: hoy
no hay forma de pedir una hoja con imágenes, y las diez rutas que ya existen no
tienen que cambiar.

### Dos cosas que decidió quien redactó esto

**El problema de la muestra viaja al archivo, y no bloquea la descarga.**
`granulometria()` puede devolver «Lo retenido supera el peso de la muestra», y la
pantalla lo muestra en ámbar **dibujando igual**, porque verlo es la única forma
de corregirlo. La hoja hace lo mismo: lleva esa advertencia escrita y se exporta.
Bloquear la descarga de la muestra que no cierra sería esconder justo la que
después genera un reclamo.

**El servidor no puede saber si el PNG que recibe tiene algo que ver con la
muestra**, y eso queda asumido. La ruta valida que sea un PNG y que no pase un
tope de tamaño, pero no puede verificar que el dibujo sea el de esos números:
cualquiera con acceso a Calidad podría mandar una imagen ajena y recibir una
planilla con mediciones reales y un gráfico que no les corresponde.

Se asume porque el margen que abre es chico: quien tiene acceso a esos datos
puede armar el mismo informe falso en Excel en treinta segundos, y este archivo
no es un documento firmado ni una fuente de autoridad — es una comodidad para no
copiar números a mano. Queda escrito para que la próxima persona lo sepa en vez
de descubrirlo.

## Lo que queda afuera

- **Un gráfico vivo en el Excel**, por lo de arriba.
- **Exportar varias muestras en un archivo.** Es la muestra que se está mirando.
- **Exportar en PDF o en imagen suelta.** Se pidió Excel.
- **Que la exportación invente o corrija un número.** Es lo que está en pantalla,
  con el estado de los tamices que tenga en ese momento.
- **Comparar el pasante contra una especificación.** Hay 2 límites cargados en
  todo el sistema y uno solo es granulométrico; dibujarlos ya se descartó el
  05/11 por eso mismo, y vale igual acá.

## Restricciones, que son las del repo

- Todo en **castellano**: nombres, comentarios, textos y mensajes de commit.
- **Sin migración.** Nada de esto guarda nada.
- **Tres gráficos no entran al lado en un teléfono.** El ancho útil es 343 px, y
  la pantalla ya los tiene en `grid-cols-1 sm:grid-cols-2`. Tres en una fila a
  ese ancho son 114 px cada uno. Hay que decidir el escalonado —y medirlo, no
  suponerlo—, porque esto no lo atrapa `revisar-responsive.mjs`: ve las grillas
  de tres o más **sin breakpoint**, y una con breakpoint le pasa por al lado.
- **`<Select>` y no `<select>`**, y nada de `w-*`, `text-*` ni `border-*` pegado
  a `.input`, `.card` o `.btn-*`: esas clases están fuera de capa y le ganan a la
  utilidad sin avisar.
- Los tests van sobre **funciones puras en `lib/`**. El pasante y el armado de
  las filas de la tabla son puros y se prueban; la pantalla y la ruta no se
  testean, así que lo que merezca test tiene que vivir en `lib/`.
- **La imagen que se manda es un dato que entra**: la ruta la recibe de un
  navegador y tiene que validarla como valida cualquier cuerpo —que sea PNG, y
  con un tope de tamaño—. No alcanza con confiar en que la mandó nuestra propia
  pantalla.

## Lo que decide quien lo construya

- **Cómo se escalonan los tres gráficos** entre el teléfono y el escritorio, con
  la medición hecha.
- **Qué columnas lleva la tabla** más allá de las cuatro obvias (malla, retenido
  %, acumulado %, pasante %) y cómo se encabeza la hoja —producto, fecha de la
  muestra, peso tamizado—.
- **Cómo se marca la fila apagada.** La sugerencia es las dos cosas a la vez: una
  columna que lo diga con todas las letras, para poder filtrar, y el renglón en
  gris tachado, para que se vea sin leer la columna.
- **Si el Excel lleva los tres gráficos o sólo uno.** La sugerencia es los tres,
  porque un informe de granulometría suele mostrarlos juntos.
- **A qué tamaño se rasteriza.** Lo que se ve en pantalla son ~287 px de ancho, y
  una imagen de ese tamaño en un informe impreso se ve mal.
- **Si el botón se apaga mientras no hay nada que exportar** — una muestra sin
  granulometría, o con todos los tamices apagados.
