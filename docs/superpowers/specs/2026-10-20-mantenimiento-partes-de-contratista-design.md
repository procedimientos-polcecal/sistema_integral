# Mantenimiento — los partes diarios del contratista, y las OT que salen de ellos

**20/10/2026.** Diseño acordado.

## Qué problema resuelve

Candia —un contratista de limpieza y servicios— entrega **quince partes diarios
en papel cada quince días**. Hoy no se cargan en ningún lado: se miran, se
aprueba la factura y se archivan. El SdG no sabe qué se le hizo a cada sector ni
cuántas horas se pagaron por actividad.

Lo que se quiere de esto, en orden:

1. **Controlar la factura.** Las horas tienen que cerrar: lo que el sistema
   suma tiene que dar lo que Candia escribió.
2. **Agrupar horas por actividad.**
3. **Una OT por quincena, por sector, por actividad**, ya realizada, con sus
   horas. (Era por semana; se dio vuelta el 23/10/2026 — ver abajo.)

Y una condición de forma que decide el diseño: **se carga todo en un solo lugar
y el sistema genera las OT solo.** Cargar quince hojas y además crear veinte OT
a mano no es automatizar nada.

## Cómo es el papel

```
PARTE DIARIO N° 1301          FECHA 01-10-26
a los Sres.: FRANCISCO VARELA
HORA DE ENTRADA 08H      HORA DE SALIDA 16H

DETALLE DEL TRABAJO
  Limpieza. Horno N°1. Molino horizontal. Riego en planta.
  Planta N°3 zaranda. Bajo cintas.

HORAS NORMALES   2 P. x 8H + 1 P. x 2H        HORAS  18H
HORAS AL 50 %
HORAS AL 100 %
MATERIALES
```

Los números **son correlativos** —1301, 1302, 1303— así que un salto o un
repetido se detecta solo.

## La unidad es la quincena, no la semana (23/10/2026)

El diseño del 20/10 decía «una OT cada semana, por sector», y la primera
quincena cargada de verdad mostró que la semana no es la unidad de nada acá.
Pedido textual: *«que me interprete desde el 1ero de cada mes al 15, no importa
qué día de la semana sea»*.

**La quincena corre del 1 al 15 y del 16 a fin de mes**, sin mirar el día de la
semana. Es como Candia entrega los partes —quince hojas cada quince días— y es
como se factura, así que **una OT por quincena es una OT por lo que se paga**,
que era el objetivo número uno del documento.

Cambia en dos lugares, y son el mismo:

- **La clave de la OT** pasa a ser *(quincena, actividad, sector)*.
- **El rango que se pide se estira a quincenas enteras** en vez de a semanas.
  Pedir «del 3 al 10» trae del 1 al 15, porque la unidad es la quincena. Y
  pedir «del 1 al 15» —que es lo que se pide siempre— ya es una quincena
  entera, así que ahí estirar no mueve nada. Ésa fue la razón del cambio: con
  la semana, ese mismo pedido traía **del 28/9 al 18/10**.

Medido sobre la primera quincena de octubre, que son los partes 1301 a 1310 con
32 renglones y 144 h:

| | OT que salen | horas |
|---|---|---|
| Por semana | 20 | 144 |
| Por quincena | **10** | 144 |

Las mismas horas, la mitad de órdenes y más gordas: «Limpieza · Calcinación»
pasa de tres OT de 8 h a **una de 24 h**.

**El fin de la segunda quincena lo pone el calendario y no una tabla**: el día
0 del mes siguiente es el último del actual, así que febrero cierra el 28 y el
bisiesto el 29 sin que nadie tenga que acordarse. Está fijado con tests.

Y aparece un caso que con la semana no existía: **el 30 y el 1 son dos
quincenas aunque estén pegados**. Del 28/9 al 4/10 era una sola semana, así que
el 30/9 y el 1/10 caían juntos; ahora son dos OT, y tienen que serlo, porque
son dos facturas distintas.

Lo que **no** cambió: todo lo de «Y lo que eso NO alcanzaba a impedir» sigue
valiendo tal cual, leyendo «quincena» donde dice «semana» — un grupo que ya
tiene orden suma en vez de crear, las horas se reescriben con el total del
grupo, la fecha de cierre sólo avanza, y dos órdenes para la misma clave se
denuncian en vez de elegir una.

Verificado contra las filas reales el 23/10/2026: pedir 1/10→15/10 lee del 1 al
15, agrupa 32 renglones en 10 OT y suma 144 h, que es lo que dicen los diez
papeles.

---

## Las horas las escribe quien carga el parte (22/10/2026)

**Lo de abajo —«La regla de las horas»— es historia.** Se deja escrito porque
explica qué hay en la base del parte 1301 y por qué la columna
`horas_expresion` existe, pero **ya no es lo que hace el sistema**.

Lo que lo dio vuelta, dicho por quien pidió la función: *«el reparto automático
reparte parejo y a veces no es así»*. Era una suposición del diseño que la
primera quincena de verdad desmintió — una limpieza de horno se lleva la mañana
entera mientras un bajo cintas lleva una hora, y repartir 16 h entre cuatro
renglones manda esas horas al sector equivocado con cara de haberlas medido.

Lo que vale desde hoy:

- **Cada renglón del detalle tiene su propio campo de horas**, y las escribe
  quien tiene la hoja delante.
- **El reparto parejo queda como propuesta.** Al tipear el total los renglones
  arrancan con el total dividido por la cantidad de renglones, y se corrigen
  encima. Es la mayoría de las hojas, así que ahorra tipear cinco veces 3,6.
- **La propuesta no pisa una corrección.** Apenas se toca una hora a mano, el
  reparto automático deja de correr solo: un renglón agregado después entra en
  blanco y lo acomoda quien carga. Se vuelve a la propuesta a pedido, con el
  botón «Repartir parejo». Esto es `horasAMano` en la pantalla.
- **Lo que no divide justo lo carga el último renglón**: 16 h entre 3 son
  5,33 + 5,33 + 5,34. No es cosmética — el control exige que los renglones den
  el total escrito, así que una propuesta que arranca a centésimas de cerrar
  obligaría a corregir a mano algo que nadie midió mal. Por la misma razón la
  tolerancia es cero: la comparación es a la centésima.
- **Todo renglón lleva horas.** Un renglón en cero aparecería en el parte sin
  generar horas ni OT; se pidió que no exista. Si el frente se trabajó lleva
  horas, y si no se trabajó no es un renglón del parte.

**El control de la factura no cambió, y es lo único que importaba preservar:**
la suma de los renglones tiene que dar `horas_declaradas`, el total escrito a
mano en la casilla "HORAS". Si no da, el parte no se guarda y la pantalla dice
por cuánto está —«Los renglones suman 12 h y el papel dice 18 h: faltan 6 h»—.
Sin esa comprobación esto sería sólo transcribir.

### Lo que se fue con la expresión

El campo «Horas normales, como están escritas» se sacó de la pantalla, y con él
toda la lectura de la suma: `terminosDeLaExpresion`, `totalDeLaExpresion`,
`esRiego` y `repartirHoras` ya no existen. Eso se lleva puestas cuatro reglas
que sólo tenían sentido mientras el reparto era automático:

- que **el segundo término sea siempre el riego**. El riego es ahora un renglón
  más, con las horas que le ponga quien carga;
- que **más de dos términos** no se interpreten;
- los dos avisos cruzados: «el detalle nombra riego pero la suma no lo paga» y
  «la suma paga riego pero el detalle no lo nombra». Con horas a mano las dos
  situaciones se escriben solas y no hay nada que denunciar.

Y se lleva también la pregunta que el diseño del 20/10 había dejado abierta
—«¿las 16 h se parten entre los renglones o entre las actividades distintas?»—:
**ya no hay que contestarla**, porque no hay reparto que decidir.

**La columna `horas_expresion` no se borra, se vuelve opcional**
(`20261022102129_partes_de_contratista_horas_a_mano.sql`). El parte 1301 la
tiene y es lo que decía su papel; borrarla tiraría esa prueba para no ahorrar
nada.

### Y lo que dice la OT es otra cosa ahora

La descripción generada decía que las horas «son una convención y no una
medición por frente de trabajo», que era cierto cuando salían de dividir. Ahora
dice **de dónde salen**: las anotó quien cargó el parte repartiendo el total
escrito en la hoja. Sigue sin ser una medición, pero hay alguien a quien
preguntarle, que no es lo mismo que un número que salió de una división.

### La generación de las OT no se tocó

Agrupa igual por *(quincena, actividad, sector)*, suma las horas que estén
guardadas, y todo lo de «Y lo que eso NO alcanzaba a impedir» sigue valiendo
tal cual. Lo único que cambió es de dónde salen las horas de cada renglón.

---

## La regla de las horas — HISTÓRICA, reemplazada el 22/10/2026

Es la regla con la que trabaja Candia, no una invención del sistema:

- **El segundo término de la suma es siempre el riego.** `1 P. × 2H` son dos
  horas de riego. Si no hay segundo término, no hubo riego **aunque el detalle
  lo nombre** — y si pasa, el sistema lo muestra en vez de acomodarlo.
- **El primer término se reparte en partes iguales entre los renglones
  restantes.**

Verificado contra las tres hojas, que cierran las tres:

| parte | expresión | riego | resto | por renglón |
|---|---|---|---|---|
| 1301 | `2 P.×8H + 1 P.×2H` = 18 | 2 h | 16 h ÷ 4 | 4 h |
| 1302 | `2 P.×8H + 1 P.×2H` = 18 | 2 h | 16 h ÷ 4 | 4 h |
| 1303 | `2 P.×8H` = 16 | — | 16 h ÷ 5 | 3,2 h |

**Se reparte por renglón y no por actividad**, y la diferencia se ve en la 1301:
«Planta N°3 zaranda» y «bajo cintas» son **dos renglones del mismo sector**, así
que al agrupar se funden en una OT de 8 h. Repartiendo por actividad, limpieza
se llevaría las 16 y habría que volver a partirlas entre tres sectores — la
misma cuenta, un paso después y con una decisión más que tomar.

> **Esto lo decidió el sistema y no quien pidió la función.** La pregunta
> —«¿las 16 h se parten entre los renglones o entre las actividades
> distintas?»— quedó sin contestar. Se eligió por renglón porque en las tres
> hojas medidas **las dos respuestas dan el mismo número**, así que la decisión
> no cambia nada hoy; el día que un parte tenga dos actividades con distinta
> cantidad de renglones, va a cambiar, y entonces hay que preguntarlo. Queda
> anotado acá para que no se lea como algo que se acordó.

### Tres cosas que quedan dichas, no implícitas

- **Las horas de una OT son una convención.** Salen de dividir; nadie las midió
  por frente de trabajo. Va escrito **en la OT**, no sólo en un comentario: en
  seis meses alguien va a leer «4 h» y creer que alguien las contó.
- **3,2 h no se redondea.** Redondear rompe que la quincena cierre contra la
  factura, que es para lo que existe esto. Se guarda con dos decimales —
  centésimas de hora, treinta y seis segundos—, así que una división que no es
  exacta, 16 entre 3, deja la suma de los renglones a centésimas del papel.
  **El número con el que se controla la factura no es ésa sino
  `horas_declaradas`**, que es lo que Candia escribió y se guarda tal cual.
- **Si la suma no da, no se guarda.** La comprobación contra el total escrito a
  mano es el control de la factura; sin ella esto es sólo transcribir.

## Los nombres que usa Candia

El detalle viene en su idioma y no en el del catálogo: *molino horizontal* es el
molino de **Molienda de cal**; *bajo cintas* son las cintas transportadoras de
la **Planta de trituración 3**. Ninguno de los dos se deduce del texto.

Así que hay un **catálogo de equivalencias**: la primera vez que aparece un
nombre se lo engancha a mano y queda. La quincena siguiente ya viene puesto.
Son unos quince nombres la primera vez y casi ninguno después.

**Lo que no hace es adivinar.** Un nombre que no conoce queda vacío y lo
pregunta. Enlazar al que se le parece pondría las horas en el sector equivocado
y eso no se nota nunca — es la regla que ya rige en todo el sistema. Y lo que
ya está puesto a mano tampoco se pisa: el catálogo completa lo vacío.

El catálogo guarda **sector y, si el lugar es una máquina, equipo**. Hizo falta
al medir: la mayoría de los nombres de Candia —«Horno N°1», «Molino
horizontal», «Balanza», «Bandejas»— son equipos del catálogo y no zonas, y sin
esa columna la limpieza de un horno quedaría contada contra el sector entero.

## Esto ya se viene haciendo a mano, y con una convención fija

Medido el 20/10/2026, y es lo que define los valores de la OT en vez de
elegirlos: de las **156 OT de CANDIA** que hay en el sistema, **147 son
`CIVIL / PROGRAMADO`** y todas tienen `quien = CONTRATADO`. Las últimas ocho
—2716 a 2723— son exactamente una tanda de quincena cargada a mano: una por
sector, con sus horas y «Limpieza general» de descripción.

Y de ahí sale también la respuesta a un choque que parecía de fondo. **«Toda OT
lleva equipo» rige desde el 19/10/2026**, pero una limpieza de sector no tiene
equipo. Resulta que el problema ya estaba resuelto en la práctica: **118 de esas
156 no tienen `equipment_id`** y llevan `EQUIPO = "PO-A3 - Edificio"`, que es un
texto de la lista del formulario y no una máquina. Así que la generación hace lo
mismo —`"<código del sector> - Edificio"`— y llena `equipment_id` **sólo cuando
todos los renglones del grupo apuntan al mismo equipo**.

Quedarse con uno de dos equipos distintos sería lo peor de los dos mundos: la
orden diría una máquina que no es la única que se tocó, y **esas horas irían a
su MTBF**.

## Qué se construye

### La base

- **`mant_partes_contratista`** — una fila por hoja: proveedor, número, fecha, a
  quién, entrada y salida, la expresión de horas normales tal como está escrita,
  el total escrito, las horas al 50 % y al 100 %, materiales, y quién lo cargó.
  Único por `(proveedor_id, numero)`.
- **`mant_partes_contratista_renglones`** — actividad, el texto tal cual lo
  escribió Candia, el sector y el equipo enganchados, las horas que le tocaron
  del reparto, y a qué OT fue.
- **`mant_contratista_lugares`** — el catálogo de equivalencias: texto → sector
  y equipo. Único por `(proveedor_id, texto normalizado)`.

Las tres llevan el prefijo `mant_` y la migración es
`20261020125508_mantenimiento_partes_de_contratista.sql`.

### La pantalla

`/mantenimiento/partes-contratista`, dentro de Mantenimiento.

Una lista de los partes cargados y un botón para cargar uno. El formulario es la
hoja: número, fecha, horas de entrada y salida, el total escrito en la casilla
"HORAS", y los renglones del detalle: actividad, lugar, **las horas** y el
sector que el catálogo ya conoce o vacío para engancharlo.

**Las horas de cada renglón se escriben a mano** desde el 22/10/2026 —ver la
sección de arriba—; la pantalla las propone repartidas parejo y se corrigen
encima.

**El total se ve mientras se carga**, no al guardar: quien está mirando la hoja
tiene que poder ver que da 18 antes de pasar a la siguiente.

### La generación de las OT

Un botón sobre un rango: agrupa los renglones de esa **quincena** por
*(actividad, sector)*, suma las horas y crea **una OT realizada por grupo**, con la fecha de
cierre del último parte del grupo, el contratista, y en la descripción los
textos originales de Candia con sus números de parte.

Pasa por el alta que ya existe, así que hereda todo lo que esa ya sabe: toma el
número de la serie, escribe en «Altas del sistema» y deja el pendiente anotado
si la planilla no estaba.

**Un grupo ya generado no se vuelve a generar**: el renglón guarda a qué OT
fue, y eso es lo que impide duplicar veinte órdenes por apretar dos veces.

### Y lo que eso NO alcanzaba a impedir

Encontrado el 20/10/2026 **cargando el parte 1301 de verdad**, después de dar
el diseño por cerrado. El `orden_trabajo_id` impide reconvertir un renglón; no
impide una segunda orden con la misma clave.

Una quincena de quince hojas no se carga de una sentada. Con la agrupación
mirando sólo los renglones pendientes, la secuencia natural —cargo el 1301,
genero, cargo el 1302 del jueves, genero— daba **dos OT de «Limpieza ·
Calcinación» de la misma quincena**: la segunda corrida volvía a armar la
clave que la primera ya había convertido, sin ver que ya existía. Es
exactamente lo contrario de «una OT cada quincena, por sector», y no avisa: las
dos órdenes son válidas, cada una con sus horas.

Tres cosas lo arreglan, y van juntas:

- **El rango se estira a unidades enteras.** Pedir "del 3 al 10" trae del 1 al
  15 completo, porque la unidad es la quincena. (Decía "a semanas enteras";
  ver la sección del 23/10/2026.)
- **Se agrupan los convertidos junto con los pendientes.** Es lo contrario de
  lo primero que se escribió, y es lo que permite que el grupo sepa que ya
  tiene orden.
- **Un grupo que ya tiene orden suma, no crea.** Se le reescriben las horas con
  el total del grupo —no se suma sobre lo que haya en la base, que contaría dos
  veces lo de antes— y la fecha de cierre **sólo avanza**: un parte del lunes
  cargado después del jueves no mueve el cierre hacia atrás.

Si los renglones de un grupo apuntaran a **dos** órdenes distintas, no se toca
ninguna y se informa: repartirles horas eligiendo una sería inventar.

La vista previa dice cuál es cuál —«OT nueva» o «suma horas»— porque son cosas
distintas y la diferencia es la que importa.

Verificado contra las filas reales del 1301: primera corrida, 4 OT nuevas;
segunda sin partes nuevos, nada; segunda con el 1302 del 2/10, una sola línea,
«suma horas · 8 h · Limpieza · Calcinación».

Antes de crear nada hay una **vista previa**: el botón «Ver qué se crea» corre
exactamente la misma agrupación y la muestra. Existe porque generar veinte OT
no se deshace — una orden escrita en la planilla se borra a mano, fila por
fila.

Se crean **25 por corrida**. Cada alta son cinco llamadas a Google en serie
—la serie no se puede pedir en paralelo sin repartir el mismo número dos
veces—, así que una quincena tarda minutos; el tope evita que un pedido se
corte a la mitad sin que nadie sepa por dónde iba. Lo que queda se genera
apretando de nuevo.

## Lo que queda afuera

- **La factura en sí.** Esto da el número con el que controlarla; no la carga ni
  la cruza con Odoo.
- **Las horas al 50 % y al 100 %.** Se guardan porque están en el papel, pero no
  entran en el reparto: en las tres hojas están vacías. El día que aparezcan,
  habrá que decidir si son otra OT o un recargo de la misma.
- **Otros contratistas.** La estructura es por proveedor, así que sirve para
  cualquiera; la regla de las horas es de Candia y vive en un solo lugar.
