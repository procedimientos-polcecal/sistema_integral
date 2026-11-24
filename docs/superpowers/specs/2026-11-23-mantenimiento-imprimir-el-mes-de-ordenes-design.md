# Imprimir el mes de órdenes, sin color

Diseño acordado el 23/11/2026. Toca la pestaña «Mes» —`MesDeOrdenes`, que vive
en `app/(app)/mantenimiento/ordenes/`— y la montan **dos** pantallas con
permisos distintos.

**Antes de nada, los nombres.** Desde el 17/11/2026 los rótulos del menú no
coinciden con las rutas, a propósito (`lib/core/nav.ts`):

| En el menú | La ruta | Qué es |
|---|---|---|
| **Programación** | `/mantenimiento/planificacion` | El plan del día. La ve cualquiera con el módulo |
| **Asignación RR.HH** | `/mantenimiento/programacion` | La semana de turnos del taller. Sólo admin |

Las dos montan `MesDeOrdenes`. Cuando este documento dice «Programación» habla
de la primera, que es la que se nombró al pedir esto.

## Qué se pidió y por qué

Desde la pestaña «Mes» hay que poder **imprimir la programación del mes, de la
semana o de un día**, y lo mismo **filtrado por especialidad**. Además,
indicadores arriba de la pantalla.

La condición que gobierna todo lo demás: **la impresora del taller es blanco y
negro**, y la hoja se fotocopia. Hoy el mes dice la especialidad con color
—`COLORES_DE_ESPECIALIDAD`: ámbar, azul, verde, violeta y un gris— y el atraso
con un relleno rojo. Nada de eso sobrevive a una fotocopia.

## Lo que se midió

Contra producción el 23/11/2026.

| | |
|---|---|
| OT en la tabla | 2.900 |
| OT que caen en la grilla de noviembre (26/10 al 06/12) | 575 |
| Por especialidad | MECÁNICO 536 · ELÉCTRICO 20 · CIVIL 16 · LUBRICACIÓN 3 |
| `INSTRUMENTACIÓN` y `OTRO` | **0 usos en las 2.900** |
| Por estado | POR_HACER 365 · REALIZADO 189 · ATRASADO 18 · EN_PROCESO 3 |
| Con `fecha_fin` (ocupan más de un día) | 123 de 575 |
| OT por día, sacando el día anómalo | **mediana 6, máximo 15** |

Dos cosas que salen de ahí y que mandan sobre el formato:

**Las categorías a distinguir son cinco, no seis.** La leyenda de la pantalla ya
es de cinco —`LEYENDA_DE_ESPECIALIDADES`—, porque `INSTRUMENTACIÓN` y `OTRO` no
tienen color propio y caen en el gris junto con la celda vacía. Los datos lo
confirman: esos dos valores no existen en la tabla.

**Un día tiene entre 6 y 15 órdenes.** Es lo que tiene que entrar en un cuadro
de unos 39 × 35 mm en una A4 apaisada, y es lo que decide que el mes no pueda
listarlas.

### El día que no se puede diseñar

El 23/11/2026 tiene **356 órdenes**, y **353 son la misma**: «Cambio de
Martillos» sobre `PO-C1-04 — Molino a martillos`, todas `POR_HACER`,
`PROGRAMADO` y `app_created`, creadas 89 el 21/11, 144 el 22/11 y 120 el 23/11.
O sea que seguía pasando el día de esta medición.

**Eso es un defecto, no una carga de trabajo, y este diseño no se acomoda a
él.** El formato se piensa para 6 a 15 órdenes por día. Se abrió aparte para
averiguar por qué se generan y frenarlo; mientras tanto, el mes de noviembre se
va a ver raro y la causa no está acá.

## Objetivos

- Imprimir, desde la pestaña «Mes», el mes, una semana o un día.
- Imprimir cualquiera de los tres filtrado por una especialidad.
- Que la hoja se entienda **fotocopiada en blanco y negro**.
- Indicadores arriba de la pantalla.

## No objetivos

- No se cambia lo que la pantalla muestra en colores. El color se queda donde
  está; lo que se agrega es una hoja que no lo necesita.
- No se mueve ni se asigna nada desde la hoja. Imprimir no escribe.
- **El mes sigue sin ser la vista de entrada** de ninguna de las dos pantallas.
- No se cambia el calendario de pantalla más allá de ganar los botones de
  imprimir.

## Anti-objetivos

- **Que las hojas filtradas se parezcan entre sí.** Con 536 de 575 órdenes
  mecánicas, una hoja de mecánicos y la hoja completa son casi la misma: si no
  se distinguen de un vistazo, alguien va a repartir la equivocada.
- **Que la hoja diga de más.** Quién falta del taller es dato de admin, y una
  hoja colgada la lee cualquiera.
- **Una hoja que repita «+12 más».** En pantalla eso es un botón; en papel no es
  nada.

## Lo que se decidió

### Las marcas, todas en blanco y negro

| Qué | En pantalla hoy | En papel |
|---|---|---|
| Especialidad | Relleno de color | **Letra en un recuadro**: `M` mecánico · `E` eléctrico · `C` civil · `L` lubricación · `–` otra o vacía |
| Atrasada | Relleno rojo | **Relleno negro** con el texto en blanco |
| Arrastre | Ficha más tenue | **`→` delante del número** de OT |

Las cinco letras son distintas entre sí y no hace falta un emoji: ocupa lo
mismo, se imprime peor y depende de la fuente del navegador de quien imprima.

**La hoja va a decir algo que la pantalla no puede.** El rojo de «atrasada» es
de relleno y no una franja, y el encabezado de `coloresDeEspecialidad.ts`
explica por qué: contra los cinco rellenos de especialidad da entre 1,20:1 y
2,03:1, por debajo del 3:1 que hace falta para distinguir algo que no es texto.
O sea que **hoy, en pantalla, una orden atrasada esconde su especialidad**. Con
la letra no pasa: la letra se lee sobre el relleno negro. Ese es un lugar donde
el papel queda mejor que la pantalla, y conviene no perderlo al implementar.

La leyenda va **en el encabezado de cada hoja**, no una vez en la primera
página.

### El cuadro de un día en el mes dice cuántas hay, no cuáles

Con mediana 6 y máximo 15, listar las órdenes no entra en 39 × 35 mm. Así que el
cuadro del mes lleva:

- el número del día;
- **el total de órdenes**, en grande;
- **el desglose por especialidad** con su letra, salteando las que están en cero;
- **cuántas atrasadas**, en negro, si hay alguna.

**El mes es el mapa de carga** —qué día está lleno y cuál vacío—; el detalle se
imprime en la hoja de la semana o del día, que sí listan todo.

El argumento ya estaba escrito en el repo antes de este pedido: con veinte de
cada veintiuna órdenes mecánicas, lo que distingue un día de otro **no es de qué
especialidad son sino cuántas hay**. Por eso el calendario de pantalla también
muestra la cuenta aparte y no depende del tono para contarla.

**La gente del taller NO va en el cuadro del día**, aunque el calendario de
pantalla la muestre y aunque venga por oficio y sin nombres en la respuesta
abierta. El motivo está medido en el encabezado de `rotacionDeLaSemana.ts`: ese
número **sale constante** —4 mecánicos, 3 electricistas, 1 lubricador las nueve
semanas de noviembre y diciembre, y tampoco varía de lunes a domingo—. Repetirlo
en treinta cuadros es la misma repetición que este formato vino a evitar, y es
la razón por la que en pantalla ese conteo ya se reemplazó por la franja de
rotación. Va **una vez, en el encabezado de la hoja**.

**La suma de los días no da el total del mes, y la hoja lo dice.** Una orden con
`fecha_fin` cuenta en cada día que ocupa —123 de las 575 duran más de uno—
mientras que el total del mes cuenta cada OT una vez. Los dos números son
correctos y miden cosas distintas; taparlo haría que alguien sume la fila y crea
que la hoja está mal. Al pie: «las órdenes de varios días cuentan en cada día».

### Las tres hojas

Una sola pantalla de impresión con dos disposiciones:

- **El mes** — el calendario de siete columnas, con el cuadro de arriba.
- **La semana y el día** — una tabla con una fila por orden: la letra de
  especialidad, el número de OT, el equipo, la tarea, **los operarios puestos**
  y una **columna vacía para tildar a mano**, que es para lo que se cuelga la
  hoja.

**Los operarios van en la hoja.** `operario_1`, `_2` y `_3` ya viajan en la
respuesta abierta del calendario, y su encabezado explica por qué no son dato
sensible: quien llega ahí ya ve las órdenes enteras en el listado, y son los
mismos nombres que la planilla publica en sus columnas P, Q y R. Lo sensible
—quién falta del taller y por qué— viaja por otra ruta, que es de admin. Una
hoja que se cuelga y no dice quién tiene cada orden sirve para la mitad; además
uno de los indicadores cuenta justamente las que no tienen a nadie.

### La hoja imprime lo que estás mirando

**El botón no abre una hoja donde se vuelve a elegir: imprime el mes, la semana
o el día que tenés delante, con los filtros que tengas puestos.** Cualquier otra
cosa permite que el papel y la pantalla digan cosas distintas, que es el
anti-objetivo de repartir la hoja equivocada.

De dónde sale cada rango:

- **el mes** — un botón arriba del calendario;
- **la semana** — un botón al borde de cada fila de semana;
- **el día** — un botón en el panel del día, que ya se abre al tocarlo.

Así no hace falta inventar un selector de semana, que hoy no existe en ninguna
parte: hay celdas y hay un panel de día.

**Viajan los tres filtros, no sólo la especialidad.** El calendario filtra por
especialidad, tipo y quién, y el centinela `__SIN__` es «sin especialidad». Si
alguien tiene `tipo = PREVENTIVO` puesto y aprieta imprimir, la hoja tiene que
traer **exactamente** lo que la pantalla mostraba. **Y el título los nombra a
todos**, porque un filtro que actúa y no se lee es peor que no filtrar: es lo
que vuelve distinguibles a dos hojas que si no serían casi iguales, con 536 de
575 órdenes mecánicas. «Eléctrico · preventivo · semana del 16 al 22 de
noviembre».

Lo que esto cuesta, dicho: el mes, los filtros y el día abierto son estado
**interno** de `CalendarioDeOT`, que lo montan tres pantallas, y lo único que
hoy sale de ahí es `onRango`. La salida más barata es que **el propio
calendario arme los enlaces de imprimir** —tiene el estado— en vez de subirlo
al padre; subirlo toca las tres pantallas y ese archivo ya avisa que `onRango`
es frágil.

### Se puede guardar como PDF, y no se imprime sola

Las tres pantallas de imprimir que ya existen tienen botón **«Guardar PDF»** con
`html2pdf.js`, así que ésta también: el encargado puede querer mandar la hoja
además de colgarla, y una cuarta pantalla distinta de las otras tres sin motivo
es una pregunta para el que venga.

Lo que **no** hereda es el disparo automático: dos de las tres llaman a
`window.print()` solas a los 600 ms, y acá no conviene. La hoja del día puede
salir recortada con un aviso mientras viva el defecto de las 353 órdenes, y
auto-imprimir no deja leer el aviso antes de que salga el papel. La de RRHH ya
tampoco se auto-imprime, también a propósito.

### Los indicadores

Dos grupos, como se acordó. **El contenido concreto es una decisión mía** y
está para que se corrija:

**Hoy** — cuántas órdenes tiene hoy, cuántas de ellas están atrasadas, y cuántas
no tienen ningún operario puesto (`operario_1`, `_2` y `_3` en null).

**El mes que se está mirando** — el total, el desglose por especialidad, cuántas
atrasadas, y **cuál es el día más cargado**.

Ese último no es decorativo: es el indicador que habría hecho saltar las 353
órdenes duplicadas el primer día, en vez de que aparecieran midiendo otra cosa.

**Los indicadores respetan el filtro activo.** No es una opción: el encabezado
del calendario **ya** imprime «N órdenes en el mes» calculado sobre lo filtrado
(`totalDelMes`). Una barra arriba que dijera otro número para el mismo mes
dejaría a la pantalla contradiciéndose sola, a dos centímetros de distancia.

**El grupo «Hoy» aparece sólo cuando el mes que se está mirando contiene hoy.**
Se puede pasar a marzo con las flechas, y ahí las órdenes de hoy no vinieron en
la respuesta: no están. En su lugar va un botón **«Ir a hoy»**, que explica la
ausencia y sirve. La alternativa —un segundo pedido al servidor para tres
números— no se eligió.

### Quién puede imprimir qué

**La hoja hereda el permiso de la pantalla desde la que se la pidió**, y esto no
es un detalle: `MesDeOrdenes` recibe `puedeMover` y `puedeAsignar` sin valor por
omisión, a propósito, porque las dos pantallas reparten permisos distintos.

Lo que depende de `puedeAsignar` **no es un botón sino quiénes son**: con
`false` ni siquiera se pide `/api/mantenimiento/taller-del-mes`, que es la ruta
de admin que trae la rotación, los nombres y quién no viene. En
«Programación» esa ruta no se llama.

De ahí sale la regla: **la franja del taller sale impresa sólo si quien imprime
la ve en pantalla.** Una hoja que la trajera siempre publicaría en papel, para
cualquiera con el módulo, lo que la pantalla le esconde.

**Y se decide con las dos cosas a la vez, porque un parámetro no es un
permiso.** La hoja va a ser una URL que cualquiera con el módulo puede tipear
—`/planificacion` la ven también los usuarios con `lectura`—, así que un
`?taller=1` sólo **pide** la franja: quien **autoriza** es `esAdminMantenimiento`
en el servidor, como en la ruta que hoy la sirve. Las dos condiciones juntas:

- sólo el parámetro, y la franja se filtra a cualquiera que adivine la URL;
- sólo el permiso re-derivado, y un admin que imprime desde «Programación»
  recibe en papel la franja que su propia pantalla le escondió — que es
  exactamente lo que esta regla vino a impedir.

**En qué hojas aparece:** en la del mes y en la de la semana, que son las que
hablan de una semana entera. La del día no la lleva: para un día la pregunta no
es la rotación sino quién tiene cada orden, y eso ya está en la columna de
operarios.

## Las trampas de este repo que aplican

### El rango tiene tope de 63 días

`/api/mantenimiento/calendario` acepta `desde` y `hasta` y rechaza un rango
mayor a 63 días contando los extremos. Un mes entra con las semanas de relleno
—noviembre de 2026 va del 26/10 al 06/12, seis filas y 42 días—, pero un rango
armado a mano puede pasarse y la ruta contesta 400.

### La hoja tiene que estar entera antes de `window.print()`

Las tres pantallas de imprimir que ya existen disparan el print con un
`setTimeout` después de montar. Si la hoja pide los datos desde el cliente, hay
que esperar a que lleguen: imprimir una grilla a medio cargar sale en blanco y
**no se nota hasta que sale el papel**.

### El `@media print` del armazón ya existe

`.no-print` y las reglas que sueltan el alto del armazón están en
`app/globals.css`. **No se vuelven a enumerar por pantalla**: enumerarlo es lo
que dejó una hoja saliendo con la barra de búsqueda encima el día que el layout
ganó un header.

### Las pantallas de imprimir están exentas del revisor responsive

`scripts/revisar-responsive.mjs` saltea cualquier ruta que contenga
`/imprimir/`. O sea que los anchos de la hoja no pelean contra los 343 px del
teléfono. **Lo que no está exento es la barra de indicadores**, que vive en la
pantalla: ahí sí valen las reglas de siempre, incluido que una grilla de tres o
más columnas lleva breakpoint.

### El desplegable y las clases sin capa

El filtro de especialidad se escribe `<Select>`, no `<select>`. Y un `text-*` al
lado de un `.btn-*`, o un ancho al lado de `.input`, no se aplican: las clases de
`globals.css` están fuera de toda capa y le ganan a cualquier utilidad. Para un
color de estado va `style`, que es lo que ya hace `colorDeEspecialidad`.

### La especialidad se compara sin tilde ni mayúsculas

La celda de la planilla trae `Lubricacion` tanto como `LUBRICACIÓN`. Las dos
funciones que ya existen —`colorDeEspecialidad` y `oficioDeLaEspecialidad`—
normalizan con `norm()`. La letra tiene que salir del mismo camino: una tabla
nueva indexada por el texto crudo dejaría la mitad de las órdenes en `–` sin que
nada avise.

### `arrastre` es «este día no es el inicio»

Se decide contra el inicio verdadero de la orden y no contra el borde del rango.
Una orden que empezó el 30/10 es arrastre el 01/11 aunque la hoja arranque ahí.
`armarElCalendario` ya lo resuelve; lo que la hoja no puede hacer es
recalcularlo por su cuenta.

## Lo que queda para quien lo construya

1. **Dónde vive la pantalla de imprimir.** `MesDeOrdenes` no está en ninguna de
   las dos carpetas que lo montan sino al lado del calendario, y por la misma
   razón la hoja probablemente vaya en
   `app/(app)/mantenimiento/ordenes/imprimir/`. Lo que no puede pasar es que
   haya dos hojas, una por pantalla, que se separen con el tiempo.
2. **Si la hoja se arma en el servidor o pide los datos desde el cliente.** Lo
   que manda es la trampa de arriba: tiene que estar entera antes del print.
3. **Qué hace la hoja del día cuando el día tiene 356 órdenes.** Un corte con
   aviso es razonable mientras el defecto siga vivo.
4. **Si la semana imprime una tabla por día o una sola corrida de siete.**

## Lo que sólo se puede comprobar imprimiendo

- Que el mes **entre en una A4 apaisada**. El caso apretado es el de seis filas,
  no el de cinco: noviembre de 2026 sirve para probarlo.
- Que el relleno negro de «atrasada» **siga siendo negro fotocopiado** y no un
  gris que se confunda con el encabezado.
- Que la letra del recuadro se lea a 6 u 8 puntos después de una fotocopia.
