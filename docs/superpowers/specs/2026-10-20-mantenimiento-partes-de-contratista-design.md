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
3. **Una OT por semana, por sector, por actividad**, ya realizada, con sus horas.

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

## La regla de las horas

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
hoja: número, fecha, horas de entrada y salida, los términos de personal × horas
—que suman solos y se comparan contra el total escrito—, y los renglones del
detalle: actividad y lugar, con el sector que el catálogo ya conoce o vacío para
engancharlo.

**El total se ve mientras se carga**, no al guardar: quien está mirando la hoja
tiene que poder ver que da 18 antes de pasar a la siguiente.

### La generación de las OT

Un botón sobre una semana: agrupa los renglones de esa semana por *(actividad,
sector)*, suma las horas y crea **una OT realizada por grupo**, con la fecha de
cierre del último parte del grupo, el contratista, y en la descripción los
textos originales de Candia con sus números de parte.

Pasa por el alta que ya existe, así que hereda todo lo que esa ya sabe: toma el
número de la serie, escribe en «Altas del sistema» y deja el pendiente anotado
si la planilla no estaba.

**Un grupo ya generado no se vuelve a generar**: el renglón guarda a qué OT
fue, y eso es lo que impide duplicar veinte órdenes por apretar dos veces. Un
parte cargado después del primer botonazo entra en el siguiente sin repetir
nada.

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
