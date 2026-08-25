# El tablero de compras pasa a ser cinco indicadores

Diseño acordado el 25 de agosto de 2026.

## El problema

El tablero es un kanban de cinco columnas con una tarjeta por requerimiento.
Funciona mientras el trabajo en curso es poco, y deja de funcionar con el
histórico encima: la columna PEDIDO acumula más de mil pedidos cerrados porque
nada los saca de ahí, y la única defensa que tiene hoy es mostrar apenas los
últimos 90 días (`DIAS_DE_PEDIDO`). El recorte se avisa con un cartel, pero un
tablero que esconde el 90% de una columna ya no es un tablero.

Al mismo tiempo, para elegir qué mirar hay que abrir desplegables: tres filtros
arriba y uno de orden por columna. La información que importa de un vistazo
—cuánto trabajo hay en cada etapa y cuánta plata representa— está repartida en
encabezados chiquitos.

## La decisión

El tablero deja de mostrar el trabajo y pasa a mostrar **el tamaño** del
trabajo: cinco indicadores, uno por etapa, y el detalle a un clic en una
pantalla que ya existe.

Es un cambio de carácter, no sólo de forma, y conviene decirlo: se pierde la
comparación lado a lado de las pilas, que hacía visible el cuello de botella.
A cambio, la etapa PEDIDO deja de mentir y el tablero deja de depender de traer
el histórico a memoria.

## 1. El tablero

`/compras/tablero` queda como una sección con cinco botones-indicador adentro,
en el orden del circuito. Cada uno muestra la etiqueta del estado con el color
que ya tiene, la cantidad en grande y el monto comprometido debajo.

Es un Server Component sin estado de cliente: no queda nada que justifique uno.

La ficha es el componente `Tarjeta` que ya usa el dashboard de compras. Se saca
a `components/Indicador.tsx` y lo comparten los dos, en vez de dejar dos fichas
parecidas que se van separando con el tiempo.

### De dónde salen los números

De una vista nueva, `compras_resumen_por_estado` (migración `030`), que agrupa
por `estado_compra` y devuelve cantidad y monto. Se declara con
`security_invoker = true` para que respete RLS como cualquier tabla; la política
de lectura de `compras_requerimientos` es `using (true)` para `authenticated`,
así que el resultado es el mismo que ve la persona.

Sólo cuenta lo que ya pasó por gerencia (`estado_aprobacion = 'APROBADA'`), que
es lo que el tablero mira hoy: el circuito de compra arranca ahí.

Contar en la base es lo que destraba PEDIDO. El tablero de hoy trae las filas y
cuenta en memoria, y por eso necesita la ventana de 90 días; una consulta de
cinco filas no la necesita.

## 2. A dónde lleva cada botón

Cuatro al listado de requerimientos con el filtro en la URL, y «Para comprar» a
la bandeja que ya hace ese trabajo:

| Botón | Va a |
|---|---|
| Sin iniciar | `/compras/requerimientos?estado_compra=SIN_INICIAR` |
| En comparativa | `/compras/requerimientos?estado_compra=EN_COMPARATIVA` |
| Para comprar | `/compras/para-aprobar` |
| Compra aprobada | `/compras/requerimientos?estado_compra=APROBADO` |
| Pedido | `/compras/requerimientos?estado_compra=PEDIDO` |

**«Para comprar» no estrena pantalla a propósito.** `/compras/para-aprobar` ya
es la página de ese estado, y lo hace mejor que una tabla: despliega la
comparativa completa de cada pedido, y elegir un presupuesto *es* aprobar la
compra. Una segunda pantalla para el mismo paso significaría dos caminos con
reglas distintas para la misma decisión.

Para que los enlaces funcionen, **Requerimientos aprende a leer la URL**: los
ocho filtros, no sólo el estado. El tablero de hoy ya enlaza a
`?estado_compra=PEDIDO` desde el cartel de pedidos viejos y ese filtro nunca se
aplica, porque el listado guarda todo en estado local. Leer la URL arregla ese
enlace roto y, de paso, hace que cualquier vista filtrada se pueda pasar por
link.

Los filtros se leen una vez, al montar. La página no reescribe la URL a medida
que la persona cambia los desplegables: el query string es el punto de entrada,
no un espejo del estado.

Un valor que no corresponde a ningún estado, área o proveedor conocido se
descarta en silencio y el filtro queda vacío. Es preferible a mostrar una tabla
vacía por un filtro fantasma que la persona no puede ver ni quitar.

## 3. La columna de acción en Requerimientos

La tabla gana una última columna, siempre presente, con el paso siguiente de
cada fila:

- Requerimiento **aprobado por gerencia** y con paso siguiente → el botón que
  corresponde: `Pasar a comparativa`, `Comparativa lista`, `Registrar el pedido`
- En **PARA_COMPRAR** asignado a otra persona → no un botón, sino a quién le
  toca, en gris. Aprobar la compra es de quien la tiene asignada: en la planilla
  el estado dice a quién le toca, y que apruebe otro dejaría los dos lados
  diciendo cosas distintas
- Sin aprobación de gerencia todavía, o ya en `PEDIDO`, `RECIBIDO` o `DENEGADO`
  → un guión
- Sin nivel de edición → la columna no se dibuja

El diálogo que junta los datos del paso (`ModalAvanzar`) sale de
`TableroClient.tsx` a `app/(app)/compras/requerimientos/ModalAvanzar.tsx`, que
es quien lo usa ahora. La lógica de qué exige cada paso no se toca: sigue en
`SIGUIENTE_ESTADO`, `ACCION_SIGUIENTE` y `ESTADOS_QUE_PIDEN_DATOS`. La ruta
`PATCH /api/compras/requerimientos/[id]` tampoco se toca.

Al avanzar se recarga la tabla con su propia consulta, no con `router.refresh()`:
las filas las trae el cliente, así que refrescar el árbol de servidor no las
cambiaría.

### Los datos que el diálogo necesita

Cuántos presupuestos tiene el requerimiento y cuál quedó elegido. Como la tabla
pagina de a 50, se piden para las 50 filas visibles con un `.in()` de 50 ids
—unos 1,8 KB de URL, muy lejos del límite— junto con cada página.

Es más barato y más seguro que lo que hace el tablero hoy, que filtra por estado
sobre todo el histórico justamente para evitar una lista de ids de 37 KB.

### Corrección al pasar

El tablero arma la lista de aprobadores desde `usuario_modulos` con nivel
`admin`. La fuente correcta es `compras_aprobadores`: es la que decide quién
puede aprobar de verdad, y por eso `puedeAprobarCompras()` la consulta a ella.
Ser admin del módulo y estar autorizado a aprobar un gasto son cosas distintas.
Al mudar el diálogo se usa `aprobadoresDeCompras()`, que ya existe.

## 4. Lo que se va

- `app/(app)/compras/tablero/TableroClient.tsx`, entero
- `DIAS_DE_PEDIDO`, el conteo de pedidos viejos y el cartel de «últimos 90 días»
- `ESTADOS_EN_CURSO`, si no queda nadie usándolo

`COLUMNAS_TABLERO` sobrevive: pasa a ser el orden de los indicadores.
`ORDENES_TABLERO` y `ordenarRequerimientos` siguen en uso en la bandeja de
«Para aprobar».

El menú lateral no cambia: «Tablero» sigue apuntando a `/compras/tablero`.

## Pruebas

`lib/compras/` ya tiene nueve suites de vitest. Se suma una para la lectura de
filtros desde la URL (`lib/compras/filtrosUrl.ts`):

- un query string vacío no deja ningún filtro puesto
- un estado de compra válido se lee
- un estado inventado se descarta y no queda filtro
- un id de área que no está en la lista conocida se descarta
- `AMBAS` sobrevive como valor de empresa, porque no es un id sino una condición

Es el error que rompería la pantalla en silencio: un filtro que la persona no ve
y no puede quitar deja una tabla vacía que se lee como «no hay nada».

## Alcance

Queda afuera, y sigue pendiente de antes:

- El seguimiento de la recepción (`RECIBIDO`). Cuando exista, se suma como sexto
  indicador y `SIGUIENTE_ESTADO` gana un paso; nada de este diseño lo estorba.
- La pantalla de la comparativa en sí.
