# La trazabilidad del repuesto: del RI a la OT

**Fecha:** 23/11/2026 · **Módulos:** Compras, Inventario, Mantenimiento

## Qué se quiere y por qué

Hoy el seguimiento de una compra termina cuando el material llega. Se puede
contestar «¿se recibió?» y no «¿en qué se usó?». El pedido es que la ficha de un
RI cierre el círculo: **que se pueda justificar la compra con el trabajo que la
consumió**.

El pedido textual fue: *«en función al seguimiento de compra y al ingreso y
egreso de un artículo del inventario, se haga un nexo con la OT, para poder
completar la trazabilidad del repuesto en el seguimiento de compra, justificando
su aplicación»*.

## Lo que ya existe, medido el 23/11/2026

Antes de diseñar nada se midió contra la base y contra la planilla del almacén.
Estos números son los que mandan sobre el resto del documento.

**El primer tramo ya está hecho.** La ficha de un RI
(`app/(app)/compras/requerimientos/[id]`) ya muestra «entradas al pañol»: lee
`inventario_movimientos` por `requerimiento_id`. Y está poblado:

| | |
|---|---|
| movimientos de inventario | 5.063 |
| entradas | 1.166, de las cuales **766 traen su RI** y las 766 están enlazadas a `compras_requerimientos` |
| salidas | 3.897, de las cuales **0 traen RI** y **0 nombran una OT** |
| ajustes | 0 |

**El segundo tramo no existe.** La salida dice quién la pidió (3.890 de 3.897),
el sector (2.879) y a veces la máquina (622). Nunca la orden de trabajo.

**El puente de Mantenimiento existe y está vacío.** La migración
`20261116082907_ri_de_repuesto.sql` creó `mant_ri_de_repuesto` para pegar un RI
a un repuesto de una OT o a un artículo del pañol. Hoy tiene **0 filas**, y los
**37** renglones de `ordenes_trabajo_repuestos` tienen **0** `articulo_id`. No es
que no sirva: es que pide tipear a mano un número que el sistema acababa de
saber (ver «El hallazgo» más abajo).

**El kardex se carga en la planilla, no en la app.** De los 5.063 movimientos,
**5.033 vienen de Sheets y 30 de la app**. La pestaña `Entradas  Salidas` del
libro `GESTIÓN DE ALMACÉN POLCECAL POLYSAN` tiene doce columnas —`N° RI`,
`CODIGO`, `DESCRIPCION`, `ENTRADAS`, `SALIDAS`, `QUIEN LO PIDIÓ`, `STOCK`,
`FECHA`, `PROVEEDOR`, `SECTOR`, `EQUIPO`, `¿STOCK ACTUAL<=S.S.?`— y **ninguna de
OT**.

**Y el dato que decidió el diseño:** preguntado explícitamente, el usuario
contestó que **hoy el pañol no entrega contra una OT**. El hábito no existe.

## El hallazgo: el vínculo se sabe gratis y se tira

Cuando alguien pide un repuesto desde una OT, `RepuestosOTModal` abre el
formulario de Compras precargado (`NuevoRequerimientoModal` con `inicial`). La
ruta `POST /api/compras/requerimientos` crea el RI y **devuelve su número**
(`select("id, nro_ri")`), pero el `onSaved()` del modal no recibe nada: sólo
muestra «Pedido cargado». Para dejar constancia, después una persona tiene que ir
a tipear **ese mismo número** a mano en `/api/mantenimiento/repuestos/[id]/ri`.

Ésa es la explicación de las 0 filas, y es la parte más barata de arreglar.

**Pero el arreglo no es pegar ese número al puente**, y entenderlo bien es lo que
le bajó el precio a la parte A (ver «El diseño · A»). Dos razones, las dos
comprobadas en el árbol:

- **El puente responde otra pregunta.** `mant_ri_de_repuesto` alimenta «lo que
  viene» (`cuentaDeUnRepuesto.ts`): cuánto de lo que falta ya está cubierto. Si
  el renglón tiene `articulo_id`, el RI se pega **al artículo** y vale para todas
  las órdenes abiertas que piden esa pieza — así que de esa fila **no se puede
  sacar de qué OT nació el pedido**. Hoy no se nota porque los 37 renglones
  tienen 0 `articulo_id`; se rompería callado el día que alguien elija uno, que
  es justo lo que el módulo empuja a hacer.
- **El botón «Pedir a Compras» no pide permiso de Mantenimiento, a propósito.**
  Su docstring lo dice con todas las letras: «un requerimiento lo puede generar
  cualquier usuario del SdG, así que ese botón no depende del permiso de edición
  de Mantenimiento». Y la ruta del puente sí lo pide. O sea que colgar A de esa
  ruta le habría contestado **403 a casi todo el que pide un repuesto**, con un
  cartel que además le pide pegarlo a mano — algo que tampoco puede hacer.

## Objetivos

1. Que la ficha de un RI diga **para qué OT se pidió**, sin que nadie tipee nada,
   cuando el pedido nació de una OT.
2. Que la ficha de un RI muestre **qué salió del pañol** de ese artículo después
   de la entrada, con lo que ya se sabe de cada salida, y permita que una persona
   **confirme contra qué OT fue**.
3. Que las dos cosas se lean separadas y nunca se confundan: una es intención y
   la otra es consumo.
4. Que lo del punto 2 funcione **sobre lo ya cargado** —las 766 entradas con
   RI—, no sólo de acá en adelante.

## No objetivos

- **No se le cambia el hábito al pañol.** No hay columna nueva en la planilla del
  almacén ni campo obligatorio en el mostrador. Lo decidió la respuesta del
  usuario: sin el hábito, esa columna quedaría tan vacía como el puente.
- **No se infiere ninguna OT.** Ni por equipo, ni por fecha, ni por parecido de
  nombre. El sistema ofrece candidatos y una persona confirma. La regla del repo
  es explícita: enlazar al que se le parece es peor que dejar en null.
- **No se reparte la cantidad.** Una salida se atribuye entera a una OT o a
  ninguna. Ver «Lo que se pierde a propósito».
- **No se toca el costeo.** `costoEquipo.ts` y el gasto por equipo de Compras
  quedan como están. Este vínculo es trazabilidad, no imputación contable, y
  mezclarlo con la plata en el mismo paso duplicaría la discusión.

## Anti-objetivos

Lo que volvería esto un fracaso aunque funcione:

- **Que la ficha afirme una aplicación que nadie confirmó.** Mostrar «se aplicó a
  la OT #2983» porque la salida fue al mismo equipo el mismo día sería un dato
  inventado que aparece en el lugar que no es, que es exactamente la falla que
  este repo persigue en todos los módulos.
- **Que la intención se lea como consumo.** «Pedido para la OT #2983» y «aplicado
  a la OT #2983» son dos frases distintas: un repuesto comprado para una orden y
  guardado en el pañol cumple la primera y no la segunda.
- **Que la pantalla prometa trazabilidad del consumible.** Ver la tabla de abajo.

## Restricciones

**La fungibilidad del stock.** Si entran 10 discos por el RI 2285 y después salen
3, nada dice que esos 3 sean de esa compra. Por eso la lista de salidas es de
**candidatas**, y la frase de la pantalla tiene que decirlo.

**Y por eso hay un techo medido.** Se contaron las salidas del mismo artículo
posteriores a cada una de las 766 entradas con RI:

| | |
|---|---|
| mediana | **2** salidas |
| p75 / p90 | 9 / 26 |
| máximo | **454** |
| sin ninguna salida posterior | 160 de 766 |
| en los 30 días siguientes | mediana 1, p90 4, máx 61; 324 de 766 sin ninguna |

O sea: para el repuesto que se compra para arreglar algo, la lista es de una o
dos filas y se confirma de un vistazo. Para el consumible —guantes, discos,
electrodos— son decenas o cientos, y «¿a qué OT fue esta bolsa?» no tiene
respuesta ni la necesita. **Esto sirve para el repuesto, no para el consumible**,
y el diseño lo dice en vez de prometer las dos cosas (ver «La ventana y el
tope»).

**La planilla no puede pisar el vínculo.** `inventario_movimientos` espeja el
kardex y la planilla manda. Lo salva un detalle que ya está documentado en
`lib/inventario/sincronizar.ts` para la columna `origen`: el `upsert` por
`sheets_fila` **sólo escribe las columnas que manda**, así que una columna que la
sincronización no incluya en su carga no entra en el `SET` y sobrevive. `ot_id`
es de ésas.

**El riesgo real no es el borrado del espejo: es que `sheets_fila` es un número
de fila.** Inventario **no** usa `borrarLoQueLaPlanillaNoTrajo` —lo usan Compras
y Mantenimiento, no éste—, así que ningún barrido se lleva movimientos. Lo que sí
puede pasar es peor y más callado: el `upsert` va `onConflict: "sheets_fila"`, y
`sheets_fila` es literalmente el índice de la fila en la pestaña. Si alguien
**inserta o borra una fila en el medio** del kardex, la fila N pasa a ser otro
movimiento; el upsert le reescribe código, fecha y cantidad, y —por el mismo
mecanismo que protege a `ot_id`— **le deja el `ot_id` del inquilino anterior**.
Eso es una aplicación confirmada mudándose sola a otro consumo, que es el
anti-objetivo textual de este documento. Es además el motivo por el que
carbonilla abandonó `sheets_fila` y pasó al id del movimiento en la columna K.

**Medido el 23/11/2026, el kardex se agrega al final y nunca se inserta en el
medio:** sobre las 5.136 filas con contenido de `Entradas  Salidas`, **las 5.136
tienen fecha legible y la fecha no retrocede ni una sola vez** respecto de la
fila anterior (las 863 restantes del rango leído son relleno sin código, de la
fila 5.138 en adelante). Del lado de la base, **0 de 5.063 movimientos tienen
`fecha` en null**.

Así que el riesgo existe en teoría y hoy no ocurre. La decisión es **no construir
maquinaria de invalidación**: va escrito en el encabezado de la migración, con la
medición y con la defensa barata por si alguna vez hace falta —comparar el
`codigo` entrante contra el guardado para esa `sheets_fila` y limpiar `ot_id`
cuando cambie—. Construirla ahora cuesta una lectura extra en cada
sincronización para defender algo que no pasó nunca en 5.136 filas.

## Enfoques

Se consideraron tres y se descartó uno antes de empezar.

**Descartado — la columna «OT» en el kardex.** Agregar una columna a la pestaña
`Entradas  Salidas` sería lo más directo: el parser lee por encabezado con alias
(`lib/inventario/planilla.ts`), así que reconocerla es barato. Se descartó por la
respuesta del usuario: hoy no se entrega contra una OT, y una columna que nadie
llena es el puente del 16/11 otra vez. **No queda prohibida**: el día que el
pañol entregue contra orden, agregarla es sumar un alias y un campo al upsert, y
este diseño no se lo impide.

**A — la intención, capturada sola.** Que el RI nacido de un repuesto de una OT
quede pegado a esa OT sin tipear nada, y que la ficha lo muestre. Contesta *por
qué se compró*. No prueba aplicación y sólo vale de acá en adelante.

**B — el consumo, confirmado por quien lo necesita.** La ficha del RI lista las
salidas candidatas y una persona confirma la OT de cada una. Contesta *dónde se
usó*, funciona hacia atrás, y no le pide nada al pañol.

**C — las dos, en la misma ficha y separadas.** Elegido por el usuario.

Se eligió **C, empezando por A**: A es casi gratis y deja de tirar lo que ya se
sabe —sin eso B arranca sin nada con qué cruzar—, B es la que contesta el pedido
textual, y C es apenas mostrarlas juntas sin mezclarlas.

## El diseño

### A · La intención: el RI recuerda de qué OT nació

**El pedido se acuerda solo, en su propia fila.** `compras_requerimientos` gana
dos columnas nullables: `ot_id uuid references ordenes_trabajo(id) on delete set
null` y `ot_repuesto_id uuid references ordenes_trabajo_repuestos(id) on delete
set null`. El formulario de Compras ya recibe valores precargados desde la OT
(`ValoresIniciales`); ahora también recibe de qué orden y de qué renglón vienen,
y la ruta `POST /api/compras/requerimientos` los guarda.

Por qué así y no pegándolo a `mant_ri_de_repuesto` (ver «El hallazgo»):

- **Es inmune a la partición artículo/renglón.** La pregunta «¿de qué OT nació
  este pedido?» tiene una sola respuesta y vive donde nace. La del puente —«¿qué
  parte de lo que falta está cubierta?»— es otra, es plural a propósito, y
  mezclarlas era el defecto.
- **No cruza ningún permiso.** Lo escribe la misma ruta que crea el RI, con el
  permiso que esa ruta ya tiene. El botón sin gatear sigue andando para
  cualquiera, que es como está decidido.
- **No puede fallar aparte.** Las dos columnas entran en el mismo `insert` que
  crea el pedido: o se guardó todo o no se guardó nada. No hace falta el cartel
  de «se cargó pero no se pudo dejar constancia», que era un parche de la versión
  anterior de este diseño.
- **No toca Mantenimiento.** `mant_ri_de_repuesto` queda exactamente como está:
  se sigue pegando a mano, cuando alguien quiere dejar asentado que ese RI cubre
  ese repuesto. Y no se pierde nada por no automatizarlo: el aviso «ya pedido» de
  la OT **no sale del puente**, sale de cruzar código y nombre (`ris.porCodigo` /
  `ris.porNombre` en `RepuestosOTModal`), así que ese lado ya funciona sin él.

**`on delete set null` y no cascada**, en las dos: Mantenimiento borra OT cuando
la planilla las deja de traer, y eso no puede llevarse un requerimiento. El RI
sigue siendo un RI; sólo deja de saber de dónde vino.

**La columna sobrevive a la sincronización de Compras** por la misma razón que
`equipo_raw`: `fusionDeLaPlanilla` conserva el valor previo para lo que la
planilla no trae (`previo?.campo ?? null`). El constructor tiene que agregarla a
`LoQueYaHabia` con ese mismo patrón; si no, la primera sincronización la borra.

**En pantalla** sale de la fila del propio RI, con un embed de la OT para mostrar
su número, su equipo y su descripción.

### B · El consumo: las salidas candidatas y su confirmación

**El dato nuevo.** `inventario_movimientos` gana `ot_id uuid references
ordenes_trabajo(id) on delete set null`, más `ot_confirmada_por`,
`ot_confirmada_en` y `ot_confirmada_desde_ri integer` —desde qué ficha se
confirmó, que es lo que permite la aclaración del renglón compartido (ver «C»);
no es foreign key, por la misma razón que en `mant_ri_de_repuesto`—. Es **una
columna y no una tabla puente**: una salida se
atribuye entera a una OT. Una tabla puente permitiría varias OT por salida, pero
entonces «cuánto fue a cada una» quedaría sin respuesta, porque `cantidad` no se
parte; y el kardex ya tiene una fila por entrega, que es la unidad con la que la
gente razona.

`on delete set null` y no cascada: si la OT se borra —y el espejo de
Mantenimiento las borra—, el movimiento sigue siendo un movimiento válido del
kardex y sólo pierde su justificación. Lo contrario haría que borrar una OT
borrara filas del kardex, que es inaceptable.

**Quién confirma.** La ruta nueva es
`PATCH /api/inventario/movimientos/{id}/ot` y pide **editar Inventario**, que es
donde vive la tabla. Medido el 23/11/2026 sobre los 16 usuarios activos: los
**5** que pueden editar Compras son **exactamente** los 5 que pueden editar
Inventario (Maximiliano, Facundo y los tres `admin_sistema`), y **no hay nadie
que tenga uno sin el otro**. Así que pedir el permiso de la tabla no le cierra la
puerta a nadie que hoy pueda abrir la ficha de un RI, y no hace falta inventar un
permiso cruzado.

> **PENDIENTE DE DECISIÓN DEL USUARIO.** Esos 5 son los que *pueden* confirmar;
> no necesariamente los que *saben*. Los dos admin de Mantenimiento que no editan
> Compras ni Inventario —Francisco y Rocco— son justamente quienes saben en qué
> orden se usó la pieza, y este diseño los deja afuera. Si eso queda así, hay un
> riesgo concreto de que B termine como el puente del 16/11: la ruta y la columna
> puestas, y cero filas, porque quien puede no sabe y quien sabe no puede. Las
> dos salidas posibles, que dan planes distintos: **(a)** la ruta acepta «editar
> Inventario **o** editar Mantenimiento», y se agrega un segundo lugar desde
> donde confirmar —el modal de repuestos de la OT—, o **(b)** se deja en los 5 y
> se asume que averiguan. Hasta que esto se decida, el resto de B no cambia.

**La ventana y el tope.** La lista no es «todas las salidas de ese artículo».
Arranca acotada a los **90 días** siguientes a la entrada y muestra **hasta 10**,
con un «ver todas» que levanta la ventana. Los números salen de la medición: con
la ventana de 30 días la mediana es 1 y el p90 es 4, pero 324 de 766 entradas se
quedan sin ninguna candidata, que es demasiado perder; a 90 días la cola sigue
siendo corta para el repuesto. Y el tope es lo que impide que un artículo de 454
salidas rompa la pantalla.

**El mismo día cuenta** (`>=` y no `>`). La `fecha` es un `date`, así que dentro
de un día no hay orden; y «llegó y se usó hoy» es el caso típico del repuesto que
se compra para arreglar algo — descartarlo por no poder ordenar las horas sería
perder justo la candidata más probable.

**La fecha faltante no es un eje del diseño, pero la función no se cae por ella.**
`inventario_movimientos.fecha` es nullable a propósito desde `20260902115220`
(«no se sabe cuándo» no es «hoy»), y medido hoy hay **0 de 5.063** sin fecha. La
regla, por si aparece una: una **entrada** sin fecha no puede ordenar nada, así
que no lista candidatas y la pantalla lo dice («la entrada no tiene fecha»); una
**salida** sin fecha no entra, porque no se puede afirmar que sea posterior.

**Lo que se muestra de cada salida**, todo dato que ya existe: fecha, cantidad,
quién la pidió, sector y máquina. Y el botón para elegir la OT.

**El selector de OT** es el mismo patrón que ya anda en
`MantenimientosClient` («Vincular OT existente»): busca contra
`GET /api/mantenimiento/ordenes?q=` y lista N°, descripción y estado. Se extrae a
un componente compartido en vez de copiarse. Esa ruta pide **ver Mantenimiento**,
que los 5 tienen.

### Quién lee qué, y con qué cliente

**La ficha de un RI la abre cualquier usuario con sesión.** `page.tsx` sólo
redirige si no hay sesión, y la policy de SELECT de `compras_requerimientos` está
abierta a `authenticated`. Pero los tres datos de la Trazabilidad están cerrados
por módulo: `inventario_movimientos` con `tiene_acceso_inventario()`,
`mant_ri_de_repuesto` y `ordenes_trabajo` con `mant_puede_ver()`. Hoy las
«entradas al pañol» se leen **con el cliente de sesión**, así que a quien no
tenga grant de Inventario la sección ya le desaparece sin decir por qué.

La sección se parte según de dónde sale cada dato, que es lo que la vuelve
coherente:

- **«Se pidió para» es una columna del propio RI** (A), así que se lee con el
  cliente de sesión como el resto de la ficha y **la ve cualquiera que pueda
  abrirla**, incluido quien hizo el pedido. Es su propio pedido: que diga para
  qué orden lo cargó no le agrega permiso a nadie. El embed de la OT, en cambio,
  está cerrado, así que el número y la descripción vienen resueltos desde el
  servidor con el cliente admin junto con la fila.
- **Las entradas, las salidas candidatas y su confirmación** se leen con el
  **cliente admin** y la sección se muestra a quien **puede editar Compras** —los
  mismos 5 del seguimiento—. Son datos de otros dos módulos cruzados entre sí, y
  el precedente es explícito: `app/api/mantenimiento/repuestos/[id]/ri/route.ts`
  usa admin justamente porque cruza órdenes y vínculos de otras personas, y pone
  el permiso en la ruta. Esto suma una entrada más a las 108 rutas con cliente
  admin, y por eso el permiso va escrito arriba del archivo.

**Y la pantalla distingue «no hay» de «no podés ver».** Para quien no edita
Compras la sección no se dibuja; para quien sí la edita y no hay movimientos,
dice que no los hay. Las dos cosas no pueden verse iguales: ése fue el defecto
que la migración de lectura de Mantenimiento dejó documentado.

### C · Cómo se leen juntas sin mezclarse

La ficha del RI tiene hoy una sección «Entradas al pañol». Pasa a ser una sección
**Trazabilidad** con tres renglones en este orden, y cada uno dice de qué habla:

```
Trazabilidad
──────────────────────────────────────────────────────────
Se pidió para     OT #2983 · Molino 2 · «Cambio de rodamiento»
                  (desde el repuesto «CAJA DE RODAMIENTO UPC 213»)

Entró al pañol    17/11/2026 · 10 un. · DISCO DE CORTE 9"

Salió del pañol   18/11/2026 · 2 un. · ORTIZ, Facundo · Filler 1 · Molino 2
                    → aplicado a la OT #2983   [cambiar]
                  22/11/2026 · 1 un. · LENZETTI, Maximiliano · Pañol
                    → sin justificar           [elegir OT]
```

Reglas de lectura, que son la mitad del diseño:

- **«Se pidió para» sale de A y «aplicado a» de B.** Nunca se funden en una sola
  frase, y la pantalla no dice «se aplicó» por el solo hecho de que se haya
  pedido para esa orden.
- **«Sin justificar» no es un reproche ni un pendiente del sistema.** Es el
  estado normal: hoy 3.897 de 3.897 salidas están así. No genera aviso, no suma a
  la campana, no manda push. El encabezado de `lib/home/avisos.ts` pide que un
  aviso tenga una persona nombrada esperando y algo frenado; acá no hay ninguna
  de las dos.
- **Si no hay nada que mostrar, la sección no aparece**, como hoy con las
  entradas.
- **El vínculo es del consumo, no del pedido, y eso se ve.** Dos entradas del
  mismo artículo por dos RI distintos comparten sus salidas posteriores, así que
  una salida confirmada desde la ficha del RI 2285 también aparece confirmada en
  la del 2310. Es correcto —esa unidad se usó en esa orden, haya salido de una
  compra o de la otra— y por eso el renglón **dice desde qué RI se confirmó**
  cuando no es el que se está mirando: «aplicado a la OT #2983 (confirmado desde
  el RI 2285)». Sin esa aclaración, la ficha del 2310 se lee como si ese pedido
  hubiera sido el aplicado.
- **El listado de seguimiento** (`/compras/seguimiento`) **no cambia en este
  paso.** Se evaluó una marca de «sin justificar» por fila y se dejó afuera a
  propósito: con 1.646 RI recibidos y cero salidas justificadas, esa columna
  nacería diciendo «sin justificar» 1.646 veces, que es ruido y no información.
  Se reconsidera cuando haya volumen.

## Lo que se pierde a propósito

- **La cantidad no se reparte.** Una salida de 10 unidades que se usó en dos
  órdenes se atribuye a una sola. El kardex tampoco la parte.
- **El consumible no queda trazado**, y está bien: ver el techo medido.
- **Nada de esto sale en la planilla.** Quien lee el kardex desde Sheets no ve la
  OT. Es el precio de no tocarle el hábito al pañol, y es reversible: la columna
  descartada arriba sigue disponible.
- **Si una OT se borra, el vínculo se va a null** por los dos lados. El RI deja
  de saber de qué orden nació y la salida deja de estar justificada. Es
  preferible a lo contrario —que borrar una OT se lleve filas del kardex o un
  requerimiento— y a guardar el número suelto de una orden que ya no existe, que
  no es información.

## Lo que queda al constructor

- La forma exacta de los componentes y dónde cortar el selector de OT compartido.
- Si la sección «Trazabilidad» se arma en un componente nuevo o dentro de
  `RequerimientoDetalle.tsx`, que ya es grande.
- Los textos finales de pantalla, respetando las frases que este documento fija
  («Se pidió para», «aplicado a la OT», «sin justificar», «confirmado desde el RI
  N»).
- Cómo viajan `ot_id` y `ot_repuesto_id` desde `RepuestosOTModal` hasta el POST:
  lo natural es sumarlos a `ValoresIniciales`, que ya es el canal por el que ese
  modal precarga el formulario. **`onSaved` no cambia** —A no necesita saber qué
  RI se creó—, y por eso las seis pantallas que abren `NuevoRequerimientoModal`
  quedan intactas.
- Los nombres de los archivos de migración, que los da `npm run migracion`.

## Cómo se verifica

Lo de siempre (`npm test`, `npx tsc --noEmit`, `npm run build`,
`node scripts/revisar-arbol-commiteado.mjs`), y además:

- **Tests sobre lo puro**: qué salidas son candidatas de una entrada —ventana,
  tope, orden, el `>=` del mismo día y los dos casos de fecha faltante— y cómo se
  arma el renglón de la ficha a partir de los tres orígenes, incluida la
  aclaración «confirmado desde el RI N» cuando no es el que se mira. Es lo que se
  saca de la ruta a `lib/` para poder probarlo.
- `node scripts/revisar-responsive.mjs`: la sección nueva tiene renglones con
  varios datos y es lo que se rompe en 343 px.
- **`revisar-exportaciones` no aplica y conviene saber por qué**: ese registro
  tiene una entrada por archivo que **escribe** una planilla, y acá no se escribe
  ninguna. No va a marcar nada, así que no sirve como comprobación de que esto
  está bien; la comprobación de que el vínculo no se pierde es la medición del
  kardex de «Restricciones».

## Dependencias y orden

1. **Las migraciones las corre una persona** en el editor SQL de Supabase, y acá
   hay dos tandas de columnas: las de A sobre `compras_requerimientos` y las de B
   sobre `inventario_movimientos`. Hasta que el SQL esté aplicado, **nombrar una
   columna nueva en un `select()` rompe lo que ya anda** —el deploy es automático
   y el SQL no—, así que ni A ni B se despliegan antes que su migración.
2. **A y B son independientes.** A no toca Inventario y B no toca Compras más
   allá de la pantalla, así que pueden ir en dos pasos y en cualquier orden. El
   orden sugerido sigue siendo A primero, porque es más chico y porque deja la
   ficha con algo que mostrar mientras B se construye.
3. **La decisión pendiente del usuario** (quién puede confirmar, arriba) sólo
   afecta a B: su columna y su pantalla no cambian según la respuesta, pero sí el
   permiso de la ruta y si hay un segundo lugar desde donde confirmar. Conviene
   cerrarla antes de escribir la ruta.
4. Hay otra sesión trabajando en `app/(app)/inventario/movimientos/` (commit
   `4057d5c0`, 23/11/2026). B toca sobre todo la ficha de Compras y suma una ruta
   nueva, así que el cruce es chico — pero conviene mirar `git status` antes de
   tocar esa carpeta.
