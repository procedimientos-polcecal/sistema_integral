# Despacho — Estado del módulo

El séptimo módulo del SdG. Registra el camión **mientras está en el predio**, en
vez de transcribirlo a la mañana siguiente.

Diseño acordado:
[spec de órdenes de carga](superpowers/specs/2026-09-08-despacho-ordenes-de-carga-design.md).

## Qué reemplaza

El talonario en papel **ORDEN DE CARGA** (formulario `086/2`), con su número
preimpreso arriba a la derecha, y la planilla de Google `Órdenes de Carga`, que
se llenaba a la mañana siguiente con todas las órdenes del día anterior.

El papel tiene dos mitades y dos dueños, y eso no cambió: **administración pone
qué se lleva** (cliente, material, granulometría, envase) al emitir el remito, y
**la balanza pone cuándo pasó** (los cuatro horarios, notas, la firma del
supervisor). Lo que cambió es que la mitad de la balanza ya no se transcribe: se
marca en vivo y la planilla la escribe el sistema.

## La cadena del dato

```
ventas → pedido en Odoo → remito de Odoo ─┐
                                          ├─→ orden de carga (SdG) → planilla
                     talonario en papel  ─┘
```

Cliente, producto y cantidad **ya existían en un sistema**: están en el remito.
Lo único que no existía en ninguna parte es el vínculo entre el Nº del talonario
y ese remito, más los cuatro horarios. Eso es lo que guarda este módulo.

## Alcance de lo que está hecho

De los cinco frentes que tiene el área, está hecho **uno**: las órdenes de carga.

| Frente | Estado |
|---|---|
| Órdenes de carga | **hecho** (este spec) |
| Recepción de material | sin relevar |
| Programación del día | sin relevar |
| Stock de producto terminado | sin relevar |
| Pedidos de clientes | sin relevar |

## Las cinco decisiones que hay que conocer antes de tocar el módulo

**Los tiempos y el estado no se guardan: se despejan al leer.** `tiempo de
carga` es `fin_carga − inicio_carga`, y el estado es cuál de los cuatro horarios
falta. Es la misma decisión que Producción tomó con la producción misma, y por el
mismo motivo: un valor derivado guardado se desincroniza y nada avisa. En la
planilla esas dos columnas ya eran fórmulas.

**Manda el sistema; la planilla es un espejo de una sola vía.** Al revés que
Compras e Inventario, igual que Producción. Se escribe **al cerrar la orden**,
no en cada botón: una escritura por orden y no cuatro. Una corrección posterior
reescribe la misma fila, por `sheets_fila`.

**El remito es opcional y el enlace lo elige una persona.** Polysan deja remitos
en `draft` y `confirmed` —39 en 90 días— y el camión llega igual. Sin remito la
orden se guarda con el enlace en null y se ve que le falta. **Nunca se sugiere el
remito que se le parece**: un enlace equivocado no se nota nunca.

**El material no se parsea: se mapea.** Los tres campos del talonario están
metidos dentro del nombre del producto de Odoo (`CARBONATO DE CALCIO 0-1 BOLSÓN
(NA)`), con espacios al final y sufijos `(NA)`/`(EA)`. Una expresión regular
sobre eso es la forma segura de que un día `CAL EN TOLVA` entre como envase
Bolsa. La tabla `despacho_productos` la carga una persona, y lo que falta se
muestra **"sin clasificar"**.

**Un solo botón por fila.** La cola del día ofrece el próximo horario que falta
y no los cuatro. Con un camión esperando, cuatro botones son cuatro
oportunidades de marcar el equivocado, y un horario mal marcado no se arregla sin
mirar la planilla. La hora la pone el servidor.

## La frontera con Producción

`produccion_despachos` ya registra camiones: son los renglones del parte de
turno, **lo que el capataz dice que cargó — el registro de fábrica**, no el
remito ni el pesaje.

**El mismo camión queda registrado dos veces, y no es duplicación.** Fábrica
cuenta bultos por turno; Despacho registra el remito y los tiempos por camión.
Son dos mediciones independientes con grano distinto, y cruzarlas es lo que va a
mostrar los desajustes — un spec futuro con valor propio.

Producción también dejó **el granel afuera a propósito**. Despacho es por donde
entra: `FILLER A GRANEL` y `CAL EN TOLVA` están entre los más despachados y un
remito son 36 toneladas.

Y `produccion_despachos.cliente_raw` sigue siendo texto libre esperando el
catálogo de `clientes` en el núcleo, que **este spec no trae** (ver abajo).

## Lo que se relevó de Odoo (08/09/2026)

Contra la base real, con las dos empresas en `allowed_company_ids`:

| | |
|---|---|
| Remitos de salida (`picking_type_code = outgoing`) | **10.027** (Polysan 5.771, Polcecal 4.256) |
| Por día | **20 a 28**, picos de 37 y 49 |
| `sale.order` | 8.516 |
| `product.template` | 432 |

Cuatro cosas que conviene no volver a averiguar:

- **El Nº de la orden no tiene dónde vivir en Odoo.** `stock.picking` tiene 121
  campos y un único campo propio de Studio, que es un many2one de otra cosa. La
  instancia es de un partner y no admite módulos propios.
- **`carrier_id` está vacío en 1.422 de 1.422 remitos.** El transportista no
  existe en ningún sistema. Medir por transportista exige empezar a capturarlo.
- **Las dos empresas numeran y validan distinto.** Polcecal emite
  `0001-00077045` y valida casi todo (552 `done`, 1 `draft` en 90 días); Polysan
  emite `Polys/OUT/05776` y deja colgado (19 `confirmed`, 20 `draft`).
- **Los productos tienen código interno** —`[FAG]`, `[CET]`, `[CC02B]`,
  `[P620]`—, que es el identificador legible del mapeo.

## Cómo está armado

| | |
|---|---|
| Estado, tiempos y próximo horario | `lib/despacho/orden.ts` |
| Material / granulometría / envase, y las listas | `lib/despacho/clasificacion.ts` |
| La planilla: fila, horas, fechas | `lib/despacho/planilla.ts` |
| El espejo de una sola vía | `lib/despacho/espejo.ts` |
| Importador del histórico (parseo) | `lib/despacho/importar.ts` |
| Promedios e indicadores | `lib/despacho/indicadores.ts` |
| Lecturas (con `traerTodo`) | `lib/despacho/consultas.ts` |
| Remitos y productos de Odoo | `lib/despacho/odoo.ts` |
| Permisos | `lib/despacho/auth.ts` |
| Filtros del histórico en la URL | `lib/despacho/filtrosUrl.ts` |
| Cola del día | `app/(app)/despacho` |
| Histórico e indicadores | `app/(app)/despacho/ordenes` |
| Mapeo de productos | `app/(app)/despacho/productos` |
| Rutas | `app/api/despacho/{ordenes,ordenes/[id],remitos,productos,importar}` |
| Migraciones | `20260908104728_despacho_enum_del_modulo.sql`, `20260908104729_despacho_schema.sql`, `20260909090003_despacho_la_planilla_es_una_pestana_por_mes.sql` |

## Lo que se relevó de la planilla (09/09/2026)

El spec se escribió sin poder abrir el libro y dejó dos supuestos declarados.
**Los dos eran falsos.** Se leyó con la cuenta de servicio desde local —las
credenciales de Google sí están en `.env.local`— y esto es lo que hay:

| | |
|---|---|
| Pestañas | **seis, una por mes**: `ABRIL 2026` … `SEPTIEMBRE 2026` |
| Órdenes | **1.714**, todas con Nº de orden |
| Textos distintos en `Material` | **201** |
| Nº de orden repetidos | **12** |
| Renglones cuya fecha no es del mes de su pestaña | **5** |

### No es una hoja: es una pestaña por mes

La pestaña **se despeja del mes de la orden** (`pestanaDelMes`), no se guarda ni
se configura: `GOOGLE_SHEETS_DESPACHO_TAB` quedó sin uso. Y eso obligó a la
migración `20260909090003`: el índice único sobre `sheets_fila` estaba mal,
porque la fila 45 de abril y la de mayo son dos órdenes distintas. Ahora el único
es por `(mes de la orden, fila)`.

El 1º de cada mes la pestaña nueva **no existe todavía**, así que el espejo la
crea copiando los encabezados de la anterior. Sin eso, el módulo dejaría de
escribir el primer día del mes y nadie se enteraría hasta fin de mes.

### `Tiempo de Carga` y `Tiempo en Predio` sí son fórmulas — a veces

Son `=F2-E2` y `=H2-G2` en abril, mayo, junio y julio, y **están vacías en agosto
y septiembre**: alguien no las arrastró. Así que hace dos meses la planilla no
muestra los tiempos que promete.

El espejo sigue escribiendo sólo `A:I` y no las toca: pisar una fórmula la
convierte en dato muerto. Devolverlas es arrastrarlas en la planilla, una vez.
De paso, esas fórmulas confirmaron el mapeo de columnas que el spec había
deducido del orden de los encabezados.

### La columna `Material`: 201 textos para quince cosas

`Filler a granel` aparece como `Filler a granel`, `filler a granel`,
`filller a granel`, `filer a granel` y `filler agranel` — **620 órdenes en cinco
ortografías**. Lo mismo `Cal en Bolsones` / `cal en bolson` / `cal en bolsones`.
Las granulometrías van como `02`, `0-2`, `01`, `0-1`, `200`, `1/2` y `1-2`.

Dos consecuencias. Una: **mapear en vez de parsear era la decisión correcta, y
por más margen del que suponía el spec** — ninguna expresión regular sobrevive a
esto. La otra: el módulo entrega algo que no estaba escrito, que es que la
columna pase a ser un dato clasificado y filtrable.

**De acá en más el sistema escribe la forma del libro con una sola ortografía**
(`textoParaLaPlanilla`): `Filler a granel`, `Cal en Bolsones`,
`Calcio 0-2 en Bolsones`, `Filler en Tolva`. Se eligió la del libro y no la del
sistema porque la planilla la sigue leyendo gente que tiene cinco meses de
historia arriba. Y apareció **Dolomita**, que el talonario no tiene: entró a la
lista de materiales.

### Hay celdas con el dato escondido por el formato

Varios renglones tienen la fecha cargada —el serial `46273`— y un formato de
número que la muestra **vacía**. Eso decide dos cosas:

- **El importador lee `sinFormato`**, o esas órdenes se perderían por "no tienen
  fecha". Medido: así entran las 1.714, con 0 salteadas.
- **`agregarFila` busca la última fila por la columna `B`, no la `A`.** Esa
  lectura pide el texto formateado, así que por la `A` la hoja parecería terminar
  antes y la escritura pisaría renglones cargados. Por eso `agregarFila` del
  núcleo ahora acepta qué columna manda.

### Los encabezados no se llaman igual en todas las pestañas

La columna de fecha es `Fecha`, `Fecha Orden` o `Fecha Orden de carga` según el
mes, y varias tienen espacios de más (`Hora Salida  de carga ` con dos). El
importador las busca **normalizadas y con alternativas**, y las columnas que no
son imprescindibles pueden faltar: exigir las nueve perdía las doscientas órdenes
de una pestaña a la que le faltara `Observaciones`.

## Lo que falta

### Correr la migración de la pestaña por mes

`20260909090003_despacho_la_planilla_es_una_pestana_por_mes.sql`. Las dos
primeras **ya están corridas** (verificado: las tablas contestan). Esta reemplaza
el índice único de `sheets_fila`, y hasta que corra, dos órdenes del mismo número
de fila en meses distintos van a chocar al escribirse en la planilla.

### Cargar `GOOGLE_SHEETS_DESPACHO_ID`

`1jF2lqDn_9H_BRQ8TQFNopfappOPyMGCQwFsGkWSkonM`, en `.env.local` y en Vercel. El
libro **ya está compartido** con `sheets-reader@mantenimientopp.iam.gserviceaccount.com`.
Sin la variable el espejo no escribe y cada orden queda con `sheets_pendiente`,
que es el comportamiento buscado y se ve en el Inicio y en la cola.

### Dar el módulo a alguien

**Administración → Usuarios**, módulo `despacho`: `edicion` para la balanza,
`admin` para el mapeo de productos y el importador.

### Importar el histórico

`POST /api/despacho/importar` con `{"ensayo": true}` lee las seis pestañas y
cuenta sin escribir nada — **correr eso primero**. Informa pestaña por pestaña
cuántas leyó, cuántas salteó y cuántas tienen la fecha de otro mes.

Es idempotente: `ignoreDuplicates` por `numero`, así que lo que ya está en el
sistema gana y volver a correrlo sólo agrega lo que falta.

Dos cosas a mirar en el resultado:

- **12 números repetidos.** El Nº del talonario tiene que ser único y en la
  planilla hay doce que aparecen dos veces. El importador se queda con el primero
  y los cuenta, pero son doce filas que alguien debería revisar en el libro.
- **5 renglones con la fecha de otro mes que su pestaña.** Esos entran con
  `sheets_fila` en null a propósito: si se guardara la fila, una corrección
  reescribiría la fila 45 de la pestaña equivocada y pisaría una orden ajena. Con
  la fila vacía, la corrección agrega un renglón — molesto pero visible.

### Lo que queda para specs propios

- **El catálogo de `clientes` en el núcleo.** Producción lo está esperando. Son
  más de 3.000 `res.partner` en dos empresas y el cruce va **por CUIT (`vat`),
  no por nombre**: la lección de los 147 CUITs duplicados de
  [ODOO-INTEGRACION.md](ODOO-INTEGRACION.md).
- **Los otros cuatro frentes del área**: recepción de material, programación del
  día, stock de producto terminado y pedidos de clientes.
- **Cruzar con `produccion_despachos`** para ver los desajustes entre lo que
  fábrica dice que cargó y lo que salió con remito.
- **El pesaje.** El puesto es la balanza y el peso no está en el papel, ni en la
  planilla, ni en el remito más allá de la cantidad pedida.
- **Que la orden nazca en administración** y el sistema imprima el papel,
  jubilando el talonario. Es el destino natural, pero toca el hábito de otra
  área.
- **Limpiar el histórico de la columna `Material`.** Las 1.714 órdenes
  importadas entran con su texto crudo, y por eso quedan "sin clasificar" en el
  sistema. Clasificarlas a mano no tiene sentido; lo que sí lo tendría es
  mapearlas por texto **con una tabla de equivalencias revisada por alguien**,
  no por parecido.
