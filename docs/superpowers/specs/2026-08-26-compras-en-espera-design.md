# Un requerimiento puede quedar en espera

Diseño acordado el 26 de agosto de 2026.

## El problema

Hay 24 requerimientos en curso con más de seis meses de antigüedad, y no son
todos lo mismo. Mirándolos uno por uno aparecen tres poblaciones:

- **Pedidos frenados a propósito.** RI 53, el más viejo (357 días), dice en su
  detalle `PARA TENER EMERGENCIA`. RI 319 dice `repo stock`. Nadie los necesita
  hoy y están bien donde están.
- **Pedidos repetidos.** RI 352, 353 y 354 —ladrillo y mortero refractario
  FARA— vuelven a aparecer como RI 698 y 699 setenta días después. Confirmado
  con el usuario: es la misma compra pedida dos veces.
- **Pedidos parados en la bandeja de alguien.** Once de los 24 esperan el visto
  bueno desde hace entre 200 y 290 días.

Este diseño ataca el primer grupo. El sistema hoy sólo sabe tener un pedido
abierto o denegarlo, y ninguna de las dos cosas es cierta para un stock de
emergencia: no está en curso, pero tampoco se rechazó.

La consecuencia es que la cola activa miente. Cualquier medición de antigüedad
—que es lo próximo que queremos mirar— arranca contaminada por pedidos que
están exactamente donde deben estar.

## La decisión

`EN_ESPERA` pasa a ser un estado de compra más, y se refleja también en la
planilla.

Tres decisiones que acotan el alcance:

**Se ve en la planilla.** Se suma `EN ESPERA` al desplegable de la columna
Estado. El módulo entero está construido sobre que las dos herramientas digan
lo mismo; una espera que sólo conociera el sistema dejaría la planilla
mostrando «EN PROCESO» sobre un pedido frenado.

**Vuelve a la etapa donde estaba.** Se recuerda de dónde salió. RI 244 y 245
están en «Para comprar» con aprobador asignado; mandarlos al principio del
circuito les borraría ese trabajo.

**Se pone con un clic, sin motivo ni fecha.** Decidido así explícitamente. Queda
dicho el costo: el porqué no se registra en ningún lado, y dentro de seis meses
`EN ESPERA` va a decir tan poco como hoy dice `URGENTE`. Si más adelante hace
falta, agregar el motivo es una columna y un campo.

## 1. El estado

Dos migraciones, no una: **un valor de enum no se puede usar en la misma
transacción en que se lo agrega.** El proyecto ya se tropezó con esto en la 015
y la 024, y por eso ambas tienen una sola sentencia.

- **`031_compras_estado_en_espera.sql`** — sólo
  `alter type compras_estado_compra add value 'EN_ESPERA'`
- **`032_compras_etapa_previa.sql`** — la columna `etapa_previa`, del mismo
  tipo, donde se guarda la etapa de la que salió

`etapa_previa` es nula para todo lo que no está en espera.

## 2. La traducción con la planilla

Los dos puntos donde se traduce el estado ya existen y sólo se les agrega el
caso:

- al **escribir**, `ETIQUETA_ESTADO_COMPRA` suma `EN_ESPERA: "EN ESPERA"`
- al **leer**, `estadoCompraDe` reconoce `EN ESPERA`

El estado de compra vive en las hojas `RI <ÁREA>`, no en el master. Sumar el
valor al desplegable hay que hacerlo en **cada una de esas hojas**, y es la
columna con las 841 protecciones automáticas. Es un paso manual y puede
resistirse más que el de la aprobación.

## 3. Poner y sacar

**Poner:** un botón `Poner en espera` con confirmación. El cliente manda el
cambio de estado y nada más; **la etapa previa la guarda el servidor**, leyendo
el estado actual. Que la mande el cliente sería confiar en que no se equivoque
sobre algo que el servidor ya sabe.

**Sacar:** el botón dice `Sacar de la espera` y devuelve el pedido a
`etapa_previa`. Si es nula —un dato viejo, o una espera puesta desde la
planilla— vuelve a `SIN_INICIAR`.

### Las exigencias de etapa no corren en el regreso

La ruta exige tener cosas cargadas para entrar a ciertas etapas: presupuesto y
aprobador asignado para `PARA_COMPRAR`, proveedor y costo para `PEDIDO`.

Volver de la espera no es avanzar, es retomar donde estaba. Si esas exigencias
corrieran, un pedido frenado seis meses que perdió su comparativa no podría
volver a la etapa en la que estaba, y quedaría atrapado en la espera — que es
exactamente el problema que este diseño viene a evitar.

### Quién puede

Nivel de edición, el mismo que mueve las etapas. Poner algo en espera no
autoriza ningún gasto, así que no exige estar en la lista de aprobadores.

## 4. Dónde se ve

**Un sexto indicador en el tablero.** Es lo que evita que la espera se vuelva un
agujero negro: si los pedidos frenados desaparecen de todas las pantallas, en un
año tenemos el mismo problema con otro nombre y sin nombre para buscarlo.

`COLUMNAS_TABLERO` no se toca: sigue siendo el circuito, y hay un test que fija
ese orden. Los indicadores pasan a ser `COLUMNAS_TABLERO` más la espera, armados
en `lib/compras/tablero.ts`, que es donde ya vive esa lógica. La espera no es
una etapa del trabajo sino un desvío, y el indicador lo muestra en gris para que
no se lea como un paso más.

En el listado aparecen con su chip y se filtran como cualquier otro estado. De
la bandeja de «Para aprobar» salen solos, porque esa consulta pide
`PARA_COMPRAR`.

## Pruebas

- `EN ESPERA` se reconoce al leer de la planilla, con las variantes de
  mayúsculas y acentos que ya tolera el resto
- al escribir, sale exactamente `EN ESPERA`
- los indicadores del tablero incluyen la espera, y `COLUMNAS_TABLERO` sigue
  siendo el circuito de cinco
- volver de la espera a `PARA_COMPRAR` funciona aunque el pedido no tenga
  presupuestos ni asignado

## Alcance

Queda afuera, y son los otros dos grupos de los 24:

- El aviso de repetido al cargar un requerimiento. Necesita decidir cuándo dos
  descripciones son la misma cosa, y el usuario ya advirtió el caso que lo
  complica: dos RI seguidos pueden decir lo mismo y ser para sectores distintos,
  lo que es legítimo.
- La antigüedad visible en la bandeja de aprobación.
