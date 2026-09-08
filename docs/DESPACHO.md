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
| Migraciones | `20260908104728_despacho_enum_del_modulo.sql`, `20260908104729_despacho_schema.sql` |

## Lo que falta

### Bloqueante: las migraciones no están corridas

**Las corre una persona, a mano, en el editor SQL de Supabase**, en este orden y
en dos pasos separados (el valor del enum tiene que estar commiteado antes de
que el schema lo mencione, o falla con `55P04`):

1. `20260908104728_despacho_enum_del_modulo.sql`
2. `20260908104729_despacho_schema.sql`

Hasta que corran, el módulo compila y no funciona: no existen las tablas.
Después hay que darle el módulo `despacho` a alguien desde
**Administración → Usuarios**, con nivel `edicion` para la balanza y `admin`
para el mapeo.

### Bloqueante: la planilla no está compartida

Falta darle lectura y escritura a
`sheets-reader@mantenimientopp.iam.gserviceaccount.com` en el libro
`1jF2lqDn_9H_BRQ8TQFNopfappOPyMGCQwFsGkWSkonM`, y cargar
`GOOGLE_SHEETS_DESPACHO_ID` (y `GOOGLE_SHEETS_DESPACHO_TAB` si la pestaña no se
llama `Órdenes de Carga`).

Mientras no esté, el espejo no escribe y cada orden queda con
`sheets_pendiente` — que es el comportamiento buscado, no una falla: se ve en el
Inicio y en la cola del día.

Y hay **dos supuestos declarados** en `lib/despacho/planilla.ts` que sólo se
pueden confirmar leyendo el libro:

1. La columna `Material` se escribe como los tres campos separados por un
   espacio (`Filler A granel`).
2. `Tiempo de Carga` y `Tiempo en Predio` son fórmulas, así que **no se
   escriben**: el espejo toca `A:I` y deja `J:K`.

Si alguno no es cierto, se corrige `filaDeLaPlanilla` y sus tests, que están
escritos justamente para eso.

### El importador del histórico

`POST /api/despacho/importar` con `{"ensayo": true}` lee y cuenta sin escribir
nada — **es lo primero que conviene correr**: dice si los encabezados se
reconocieron antes de insertar miles de filas. Sin `ensayo`, inserta.

Es idempotente: `ignoreDuplicates` por `numero`, así que lo que ya está en el
sistema gana y volver a correrlo sólo agrega lo que falta.

Las filas viejas entran **sin remito y sin empresa** (`empresa_id` es nullable
justamente por esto: la planilla no tiene columna de empresa, y poner una al azar
metería el camión en el patrimonio que no es).

### Lo que queda para specs propios

- **El catálogo de `clientes` en el núcleo.** Producción lo está esperando. Son
  más de 3.000 `res.partner` en dos empresas y el cruce va **por CUIT (`vat`),
  no por nombre**: la lección de los 147 CUITs duplicados de
  [ODOO-INTEGRACION.md](ODOO-INTEGRACION.md).
- **Cruzar con `produccion_despachos`** para ver los desajustes entre lo que
  fábrica dice que cargó y lo que salió con remito.
- **El pesaje.** El puesto es la balanza y el peso no está en el papel, ni en la
  planilla, ni en el remito más allá de la cantidad pedida. Si el camión se pesa
  y ese número queda en algún lado, es un dato que el módulo debería capturar.
- **Que la orden nazca en administración** y el sistema imprima el papel,
  jubilando el talonario. Es el destino natural, pero toca el hábito de otra
  área.
