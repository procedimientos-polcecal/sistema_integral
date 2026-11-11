# La curva granulométrica de una muestra

Una pantalla nueva en Calidad / Ensayos: se elige un producto y una de sus
muestras, y se ve **la curva de esa muestra**, con los tamices del eje X
prendibles y apagables.

Acordado el 05/11/2026.

## Para qué existe

Hoy Ensayos tiene gráficos, pero todos responden la misma pregunta: **cómo
viene cambiando** una determinación a lo largo del tiempo. Eso es
`/calidad/ensayos/indicadores`, que dibuja una serie por fecha y, cuando la
determinación lleva malla, **obliga a elegir una sola malla por vez**.

Lo que falta es la otra pregunta, la que el laboratorio se hace mirando **una**
muestra: **qué forma tiene este material**. Esa es la curva granulométrica de
toda la vida —los tamices en el eje X, del más grueso al más fino— y hoy no se
puede ver en ninguna parte del sistema.

Y falta con un motivo concreto, que es el que pidió esta pantalla: **un tamiz
puede no ser representativo en una muestra puntual**. Pasa de verdad y se puede
señalar con el dedo: la muestra de `Calcio 0-2` del **27/10/2026 tiene #20 en
6,0 %** cuando las otras dieciocho del mes andan entre 20 y 35. Mirando la curva
entera, ese punto tira del ojo y tapa el resto. Quien la mira quiere poder
sacarlo y ver qué dice la muestra sin él.

## Lo que se decidió, y lo que no

### La curva, y no una serie en el tiempo

Se evaluaron las dos formas sobre los datos reales de `Calcio 0-2` (19 muestras,
del 07/10 al 04/11/2026):

- **una línea por tamiz a lo largo del tiempo** —el eje X son las fechas—, que
  es la extensión natural de lo que ya hay en indicadores; y
- **la curva granulométrica** —el eje X son los tamices—, una línea por muestra.

Se eligió la curva. La serie en el tiempo **no se descartó por mala**: contesta
una pregunta distinta y además ya existe a medias en indicadores. Si algún día
se pide, es otra tarea y no una variante de ésta.

### Una muestra por vez

Se evaluó también superponer varias muestras del producto. Se eligió **una**, y
el motivo no es de pantalla sino de control: como las exclusiones son por
muestra, con varias curvas hay que decir **de qué curva** se saca el tamiz, y eso
es una fila de controles por cada curva que se agregue. Con una sola, los
tamices de abajo son inequívocamente los de esa muestra.

**Consecuencia asumida: esta pantalla no compara.** Para ver dos muestras una al
lado de la otra hay que abrirlas por separado. Se aceptó a cambio de que el
control de tamices no necesite desambiguar.

### Los dos gráficos, retenido y acumulado

El eje Y es el **retenido**. Y al lado, **para la misma muestra**, el
**acumulado**. Son dos gráficos, no uno con un interruptor: la gracia es verlos
juntos.

Los dos comparten **una sola** selección de tamices. Apagar #20 lo apaga en los
dos.

### Excluir un tamiz no recalcula nada

Apagar un tamiz **le saca el punto a la curva y no toca ningún número**. Esto es
lo más importante del diseño y conviene entender por qué se puede:

`granulometria()` de [lib/calidad/ensayos/granulometria.ts](../../../lib/calidad/ensayos/granulometria.ts)
ya devuelve, por malla, el retenido % y el acumulado %. **La exclusión es un
filtro sobre esas filas**, no un cálculo nuevo. No hay fórmula que escribir.

La alternativa —recalcular el acumulado sin el tamiz apagado— **queda
explícitamente afuera**. Con la muestra del 27/10, recalcular daría 35,6 % en #50
en vez de 41,6 %: un número que nadie midió. Es la misma regla que gobierna el
histórico de determinaciones, donde el valor se guarda sin transformar y la
inferencia vive en una etiqueta al lado. Acá la inferencia ni siquiera hace
falta.

### El acumulado saltea el tamiz apagado, sin marcarlo

Y acá está el riesgo asumido, que es la única parte de esta pantalla que puede
inducir a error. **Excluir un tamiz no hace lo mismo en los dos gráficos:**

- En **retenido**, apagar #20 saca su 6,0 % y los demás puntos no lo tocan. El
  dato sospechoso desaparece de verdad.
- En **acumulado**, no. El 41,6 % de #50 **ya tiene sumado** ese 6,0, y lo mismo
  el 56 % de #100 y el 66,4 % de #200. Apagar #20 esconde su punto, pero el valor
  que no convencía **sigue adentro de los tres que quedan a la derecha**.

Es correcto —unir #12 con #50 dice «entre esas dos mallas el acumulado pasó de
0,9 a 41,6», que es lo que se habría medido sin tamizar en #20— pero es
**fácil de leer como si el tamiz sospechoso se hubiera ido de los dos gráficos**,
y no es así.

Se evaluó marcar el hueco —el punto en gris, o un corte en la línea— y **se
decidió que no**: el acumulado simplemente saltea. Queda escrito acá porque es la
clase de cosa que nadie deduce del código, y porque si alguna vez alguien
contesta un reclamo con un acumulado de una muestra que tenía tamices apagados,
ésta es la explicación.

### Los tamices del eje son los que midió la muestra, y nada más

El eje X lleva **las mallas que esa muestra midió**. No las que declara el
producto, y no una unión de las dos.

Hay que escribirlo con lo que cuesta, porque la diferencia es grande y está
medida. De **79 muestras con granulometría, 19 midieron un juego distinto del
que declara su producto** —Filler 2 seis de 18, Filler 1 cinco de 16, Cal cinco
de 14, Calcio #200 las dos que tiene—, en las dos direcciones: hay muestras a
las que les falta una malla declarada y muestras que midieron una de más. La
**#325 está medida en 13 muestras y declarada por ningún producto**, así que un
eje armado con el juego declarado no podría dibujarla nunca. Eso solo ya obliga
a que el eje salga de lo medido.

Lo que se decidió además, y es la parte que tiene costo: **la pantalla no avisa
cuando falta una malla que el producto sí declara.** Una muestra de Filler 1 que
no midió #20 dibuja cuatro puntos y cuatro chips, y se ve perfecta. Se ve
perfecta justamente porque le falta algo, y eso pasa en una de cada cuatro
muestras.

Se decidió así a pedido, sabiendo que **va al revés de lo que ya hace el
listado**: `acumuladosDelListado()` muestra el hueco a propósito, con su porqué
escrito —una muestra a la que le falta la #325 es una muestra incompleta de un
producto fino—. Acá no. Quien use esta pantalla para contestar algo tiene que
saber que la curva muestra lo que se midió y no dice qué no se midió.

### Sin curva fantasma

La maqueta sobre la que se decidió dibujaba, además de la curva filtrada, **la
curva original en punteado**, para mostrar qué le hacía sacar el tamiz. Era de la
maqueta y **no va**: el gráfico dibuja una sola curva, la de los tamices
prendidos.

Queda anotado porque es lo que habría desactivado el riesgo del acumulado de la
sección anterior —con la punteada al lado se ve que los puntos a la derecha no se
movieron— y así se entiende que ese riesgo quedó asumido entero, y no por
olvido.

### La exclusión no se guarda

Es **cómo está mirando el gráfico quien lo tiene abierto**, nada más. Quien abra
esa muestra después la ve entera.

De ahí sale lo mejor de esta tarea: **no hay migración**. Ni tabla, ni columna,
ni DML. Nada que corra una persona antes de que esto ande.

La alternativa —dejar anotado que un tamiz no es representativo— sería un dato
sobre el dato, con su tabla, su quién y su cuándo. No se pidió y no entra.

## Lo que queda afuera

- **Guardar la exclusión**, por lo de arriba.
- **Recalcular el acumulado** sin los tamices apagados.
- **Comparar muestras** en el mismo gráfico.
- **La serie en el tiempo por tamiz**, que es la otra forma que se evaluó.
- **El histórico de determinaciones.** Esta pantalla lee `calidad_ensayos_*` y
  nada más. El histórico tiene tres años de granulometría, pero con **dos
  escalas conviviendo** —fracción antes del 02/06/2026 y porcentaje después— y
  mezclarlas en una curva es exactamente lo que
  [su spec](2026-10-29-calidad-historico-de-determinaciones-design.md) dejó
  afuera a propósito.
- **Editar la muestra.** Para eso está su ficha.

## Restricciones, que son las del repo

- **recharts**, que es lo que usan los gráficos que ya hay. El de indicadores se
  carga con `dynamic(..., { ssr: false })` y un esqueleto mientras tanto; conviene
  copiar ese patrón y no inventar otro.
- **`<Select>` y no `<select>`** para elegir producto y muestra. Con diez o más
  opciones aparece solo el buscador, y la lista de muestras de un producto pasa
  los diez enseguida.
- **Los dos gráficos juntos van `grid-cols-1 sm:grid-cols-2`.** En un teléfono el
  ancho útil son 343 px: dos gráficos al lado quedan en 171 px cada uno y no se
  lee nada. En el teléfono van uno abajo del otro. Esto no lo atrapa ningún test
  —`revisar-responsive.mjs` ve las grillas de tres o más— así que es una decisión
  a tomar al escribirlo, no algo que avise después.
- **Nada de ancho suelto al lado de `.input`**, si el control de tamices llegara
  a usar esa clase. El ancho va en un `div` que envuelva.
- **Sin migración.**
- Los tests van sobre **funciones puras en `lib/`**, como todo acá: las pantallas
  no se testean. Lo que hay para probar es poco y conviene que exista igual —qué
  filas quedan con un conjunto de tamices apagados, y que el acumulado que
  sobrevive sea el mismo número que antes de apagar nada.

## Decisiones de quien escribió esto

No salieron de la conversación: las tomé yo al redactar y están acá para que se
puedan discutir, no para que se obedezcan.

- **Bajo el gráfico del acumulado va una línea de texto** diciendo que las mallas
  que siguen ya incluyen lo que se apagó. No es marcar el hueco —eso se descartó—
  sino una aclaración al pie, y es lo único que separa asumir ese riesgo con el
  que mira avisado de asumirlo sin avisar.
- **Los tamices apagados se resetean al cambiar de muestra.** Arrastrarlos
  escondería un punto medido de una muestra que nadie juzgó, que es justo lo que
  esta pantalla no quiere hacer.
- **La página carga la muestra por id, y el selector lista todas las del
  producto, sin ventana de días.** Hoy no existe esa consulta —`traerMuestras()`
  es por ventana, 90 días el listado y 365 indicadores— así que hay que agregarla
  a `consultas.ts`, con `traerTodo()`. Sin eso, un enlace de octubre dibuja bien
  pero su muestra no aparece en la lista y la pantalla se contradice sola.
- **El enlace compartido no lleva los tamices apagados.** Es coherente con que la
  exclusión no se guarde, y el costo es que lo que se comparte es la muestra y no
  la lectura que alguien hizo de ella.

## Lo que decide quien lo construya

Nada de esto cambia lo acordado y ninguna de las dos opciones está mal:

- **Dónde vive la pantalla y cómo se llama.** La sugerencia es `/calidad/ensayos/curva`
  con el producto y la muestra en la URL, para que un resultado se pueda mandar
  por chat —que es lo que ya hace el histórico—, y una entrada en el nav de
  Ensayos al lado de «Indicadores».
- **Si los gráficos dibujan los límites.** `limiteDe()` ya resuelve el límite por
  determinación y malla, e indicadores ya los dibuja, así que sale casi gratis.
  Si se hace, que sea con los límites del producto de esa muestra. El dato que
  conviene tener antes de decidir: **hay 2 límites cargados en todo el sistema** y
  uno solo es granulométrico (`acumulado #200`, máximo 37, de un único producto),
  así que esa línea hoy sería invisible en 19 de los 20 productos.
- **Cómo se elige la muestra**: una lista al costado, un desplegable, o las dos
  cosas según el ancho.
- **Qué dice la pantalla cuando no hay nada que dibujar.** No es un caso raro:
  **12 de los 20 productos no tienen ninguna muestra**, y `Caliza P3` tiene dos
  con retenidos pero sin peso de muestra, así que ahí `granulometria()` devuelve
  el problema ya escrito —«Falta el peso de la muestra tamizada»— y conviene
  mostrar ése y no inventar uno propio.
- **Si se puede apagar el último tamiz que queda.** Es una curva de un punto o de
  ninguno; decidir qué pasa ahí es de quien lo escriba.
