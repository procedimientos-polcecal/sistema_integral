# Inventario — pedir lo que falta, sin pedirlo dos veces

**Fecha:** 2026-10-02
**Estado:** implementado y en producción el 3/10/2026 — `f066c2b` (la decisión),
`2f00224` (la pantalla y el alta) y `251130f` (el ítem del menú)
**Módulos:** Inventario (`app/(app)/inventario`, `lib/inventario`) leyendo Compras

## El problema

Hoy esto lo hace un Apps Script en la planilla del almacén. Cuando el stock de
un artículo baja del de seguridad, muestra una alerta y ofrece un botón
**GENERAR PEDIDO** que abre el Google Form de compras **prellenado**: nombre,
apellido, área, descripción, código, cantidad y fecha. No lo envía — lo abre, y
una persona confirma. Ese paso de aprobación es deliberado y se conserva.

Lo que el script no puede hacer, y es lo que justifica traerlo al SdG:

**No sabe si el pedido ya se hizo.** Su marca de "LEÍDO" vive en las
`DocumentProperties` de la planilla, indexada por código, y no tiene ninguna
relación con que exista un RI. Medido el 2/10/2026: **seis códigos tienen más de
un RI abierto al mismo tiempo**. `00473` (GUANTES DE VAQUETA) tiene el 2049 y el
1693; `00666` (PROYECTOR LED 100W) tiene el 1956, el 983 y el 984.

**No sabe quién está pidiendo.** El script tiene el solicitante escrito a mano
en el código —`Maximiliano / Lenzetti / Almacén`— así que todo pedido sale a
nombre de la misma persona, la haya hecho quien la haya hecho.

## Lo que ya está construido y no se toca

El camino de alta existe y anda desde el 11/09/2026
([spec](2026-09-09-compras-alta-a-la-planilla-design.md)): el SdG inserta el RI
y lo escribe en la hoja de respuestas del formulario, que es el único lugar
escribible de esa cadena —en el master `A2` es un `QUERY(IMPORTRANGE(...))` y
las pestañas por área son un `FILTER` del master—. De ahí baja solo.

Y `NuevoRequerimientoModal` **ya acepta valores precargados** (`ValoresIniciales`:
descripción, código, cantidad, detalle, ubicación, equipo). Hoy lo usan tres
pantallas: los avisos de Mantenimiento, los repuestos de una OT, y Mis pedidos.

**Inventario es el cuarto llamador del mismo modal.** Este spec no toca Compras.

La RLS tampoco estorba: `compras_req_select` es `using (true)` para cualquier
autenticado —"el circuito de compras es transversal a toda la empresa", dice la
018— y el `insert` permite a cualquier usuario activo cargar un pedido a su
propio nombre con `PENDIENTE`/`SIN_INICIAR`. Alguien que sólo tenga Inventario
puede ver los RI y crear uno. Ya hay precedente anotado en
`app/(app)/mantenimiento/equipos/[id]/page.tsx`.

## Lo que el faltante no es: una cola de trabajo

Acá está la decisión de diseño, y sale de medir y no de suponer. Todo lo que
sigue es del 2/10/2026, contra la base de producción.

**521 de los 1.159 artículos tienen faltante.** El 45% del catálogo. De esos,
**sólo 24 tienen un RI abierto**: quedan **497 "pendientes"**.

Nadie va a cargar 497 pedidos, y que no los haya cargado en años dice que la
lista no es una cola sino una referencia. El filtro que la convierte en algo
accionable no es el stock sino **el consumo**:

| Criterio sobre los 497 | Quedan |
|---|---|
| Stock en cero | 334 |
| Alguna salida en los últimos 180 días | **95** |
| Salida en los últimos 90 días | 75 |
| Stock cero **y** salida en 90 días | 32 |
| Salida en los últimos 30 días | 28 |

**402 de los 497 no se movieron en seis meses.** Ese es el ruido: un stock de
seguridad puesto una vez sobre algo que nadie usa. Y lo que queda se lee como
una lista de verdad: `AIRE COMPRIMIDO AEROSOL` con 12 salidas, `MINI PLAFON LED`
con 12 y la última hace dos días, `RETEN 5564` hace ocho.

**El corte es: faltante + al menos una salida en los últimos 90 días.** Un
trimestre y no un mes, porque un repuesto que se usa cada dos meses tiene que
entrar; y sin exigir stock cero, porque el que tiene 1 de 5 y se consume rápido
no puede esperar a quedarse en cero para aparecer.

## La pantalla — `/inventario/reponer`

Dos grupos, y la separación es el punto.

### Para pedir — hoy 75

Faltante > 0, activo, con salida en los últimos 90 días, **sin RI abierto**.
Ordenados por cantidad de salidas en esos 90 días, de mayor a menor: lo que más
se mueve queda arriba, que es como se corta una lista larga sin tener que
decidir dónde termina.

Cada fila muestra código, descripción, `stock / seguridad`, cuántas salidas tuvo
en 90 días y hace cuántos días fue la última. Es lo que permite decidir sin
abrir nada.

### Ya pedidos — hoy 17

Lo mismo, pero con un RI abierto. Cada uno dice **cuál**, de hace cuántos días y
en qué estado, con enlace a `/compras/requerimientos/<id>`. **Sin botón de
pedir.**

Existe para contestar "yo sé que esto falta, ¿por qué no está arriba?". Ocultarlos
sin más dejaría a esa persona sin saber si el sistema no lo vio o si ya está
pedido, y son dos problemas con dos arreglos distintos.

**El pedido fantasma no es un riesgo acá, y se midió:** de los 17, **ninguno
tiene sólo un RI viejo**. Los de 175 días (`00666`) vienen siempre acompañados de
uno reciente. Así que "tiene un RI abierto" alcanza como señal y no hace falta
una regla de vencimiento, que sería adivinar.

### Qué cierra un RI

`estado_compra` en `RECIBIDO` o `DENEGADO`, o `estado_aprobacion` en `DENEGADA`.
Todo lo demás —`SIN_INICIAR`, `PARA_COMPRAR`, `EN_COMPARATIVA`, `EN_ESPERA`,
`APROBADO`, `PEDIDO`— cuenta como abierto.

## El botón «Pedir»

Abre `NuevoRequerimientoModal` precargado con:

| Campo | Valor |
|---|---|
| `descripcion` | la descripción del artículo |
| `codigo` | el código |
| `cantidad` | **el stock de seguridad** |
| `detalle` | `Reposición de stock. Había 0 de un mínimo de 4.` |

Todo editable. El área, la empresa, la prioridad y la fecha las elige la
persona, como en cualquier alta. De ahí en adelante es el camino de Compras de
siempre.

**La cantidad es el stock de seguridad y no el faltante**, que es lo que hace el
Apps Script hoy, y lo medido le da la razón: se compra por lote y no por
diferencia. De los pedidos abiertos que corresponden a un faltante —falta 2
pidió 4; falta 15 pidió 30; falta 1 pidió 10; falta 4 pidió 12— **ninguno pidió
el faltante exacto**. Proponer el faltante propondría sistemáticamente menos de
lo que se termina comprando.

**Se abre, no se envía.** El paso que hoy da una persona apretando GENERAR
PEDIDO se conserva igual.

## La lógica, donde se pueda probar

`lib/inventario/reponer.ts`, con una función pura:

```ts
clasificarParaReponer(articulos, salidas, risAbiertos, hoy)
  → { paraPedir: Candidato[], yaPedidos: ConPedido[] }
```

Ahí viven las tres decisiones que importan y que hoy no están en ningún lado:
qué cuenta como faltante, qué cuenta como "se usa" y qué cuenta como "ya
pedido". Va aparte de la pantalla porque es la parte que decide: un corte mal
puesto acá hace que alguien pida de más o que no vea lo que se acabó.

Los umbrales —90 días— van como constantes con el número medido al lado, para
que el día que alguien los quiera mover sepa contra qué los está moviendo.

La página arma los tres argumentos:

- `inventario_articulos` con `faltante > 0` y `activo`, por `traerTodo()`.
- Las salidas de los últimos 90 días de `inventario_movimientos`, filtradas por
  fecha en la consulta —son ~4.200 movimientos en total y no hay razón para
  traerlos todos— y también por `traerTodo()`.
- Los RI con código y estado abierto de `compras_requerimientos`.

**Los tres se cruzan por el código**, que es el que las dos puntas escriben
igual: de los 509 RI que tienen código, **490 son un artículo del inventario**.

## Qué se testea

Vitest sobre `clasificarParaReponer`, que es donde están las decisiones:

- Un artículo sin faltante no entra, aunque se haya usado ayer.
- Un artículo con faltante y sin salidas en 90 días no entra, aunque esté en
  cero. Es el caso de los 402.
- Una salida de hace exactamente 90 días entra; una de hace 91, no.
- Un artículo con faltante, consumo y un RI abierto va a `yaPedidos` y **no** a
  `paraPedir`.
- Un artículo cuyo único RI está `RECIBIDO` o `DENEGADO` vuelve a `paraPedir`.
- Con varios RI abiertos se informa **el más nuevo** y se dicen cuántos hay: es
  el caso del `00666`, que tiene tres.
- El orden de `paraPedir` es por cantidad de salidas, de mayor a menor.
- Un artículo inactivo no entra en ninguno de los dos.
- Una entrada no cuenta como consumo: sólo las salidas.

## Lo que queda afuera, a propósito

**Selección múltiple.** Serían 75 RI de un click, y nadie revisa 75
formularios. El orden por consumo ya pone arriba los que importan, y el paso de
aprobación existe justamente para que cada pedido lo mire alguien.

**Crear el RI sin que nadie confirme.** Es lo que el Apps Script evita hoy y no
hay razón para perderlo al traerlo.

**Depurar el stock de seguridad.** Que 402 artículos tengan un mínimo que nadie
usa es un problema real —es el que infla los 521— pero se arregla revisando el
catálogo, no escondiéndolo detrás de un filtro. Esta pantalla lo deja a la
vista: la diferencia entre 521 faltantes y 75 para reponer **es** la medida de
ese problema.

**Avisar solo.** Nada manda un correo ni una notificación. Quien abre la
pantalla la abre porque va a pedir.

## Riesgo asumido

**Los números se mueven solos.** 75 y 17 son del 2/10/2026; cambian con cada
sincronización. Están en este documento como orden de magnitud y como prueba de
que el corte deja una lista terminable, no como algo que haya que reproducir.

**El corte de 90 días es una elección, no un hecho.** Con 30 quedaban 28 y con
180 quedaban 95. Se eligió 90 porque un repuesto que se usa cada dos meses tiene
que entrar; si en el uso resulta corto o largo, es una constante y se mueve.
