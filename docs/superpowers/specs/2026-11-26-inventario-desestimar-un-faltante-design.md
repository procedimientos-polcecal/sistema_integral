# Inventario — desestimar un faltante

**Fecha**: 26/11/2026 · **Pedido**: «Agreguemos una función de desestimar un
faltante. Que no sugiera pedir nuevamente si lo desestimo. Salvo que vuelva a
tener un movimiento, y recién ahí vuelva a aparecer.»

## El problema

`/inventario/reponer` propone comprar lo que tiene faltante **y** se consumió en
los últimos 90 días. A veces la respuesta es que no: el artículo se discontinuó,
el mínimo está mal cargado, se reemplazó por otro. Hasta ahora no había forma de
decirlo, así que esa fila volvía a proponerse cada vez que alguien abría la
pantalla.

Medido el 26/11/2026: hoy son **35 filas para pedir y 26 ya pedidas**, así que
tres o cuatro que no corresponden ya son el 10% de lo que se mira. Y la lista es
de movimiento lento —**26 de los 35 tienen una sola salida en 90 días** y la
mediana de días desde la última es 49—, o sea que una fila que no corresponde se
queda meses.

## La decisión que importa: cuándo caduca

El pedido dice «salvo que vuelva a tener un movimiento». La trampa está en qué
quiere decir «vuelve a tener», y los datos la muestran: sobre esos 35 artículos,
**la mediana del hueco entre dos movimientos consecutivos es de 0,1 días**. Los
movimientos llegan en tandas del mismo día, porque así los trae la
sincronización de la planilla.

Por eso el ancla **no es el instante** en que se desestimó. Si lo fuera, una
tanda importada cinco minutos después —con filas de días que ya estaban a la
vista— levantaría la desestimación enseguida, y el botón parecería no funcionar.

El ancla es `ultimo_movimiento`: **el día del último movimiento que el artículo
tenía cuando se lo desestimó**. La decisión vale mientras no aparezca un
movimiento de un día posterior a ése. La pregunta que contesta es «¿pasó algo
que yo no había visto?», y un movimiento del mismo día ya estaba contado en la
pantalla que se miró.

Es `date` y no `timestamptz` porque `inventario_movimientos.fecha` es un día
desde la `20260903081542`: compararla contra un instante vuelve a traer el
corrimiento de huso que esa migración vino a sacar.

**Cualquier tipo de movimiento la levanta, no sólo una salida.** Una entrada
también, aunque parezca lo contrario: si entró mercadería y el artículo sigue
con faltante, lo que se repuso no alcanzó, y eso es exactamente un hecho nuevo
sobre el que la decisión se tomó sin saberlo. Un ajuste corrige el stock, que es
el número del que sale el faltante. Lo que **no** la levanta es el paso del
tiempo: un artículo que nadie toca no cambió de situación.

## Un tercer grupo, no un filtro

El desestimado sale de «Para pedir» y va a una sección propia, con quién lo
desestimó, cuándo, por qué, y un botón para volver a considerarlo.

Es la misma razón por la que existe «Ya pedidos» y está escrita en
`clasificarParaReponer`: quien busca algo que sabe que falta tiene que poder
distinguir «el sistema no lo vio» de «ya está pedido» de «alguien dijo que no»,
que son tres problemas con tres arreglos distintos. Esconderlo del todo además
dejaría un click sin vuelta atrás, y la vuelta atrás es la mitad de la función.

**La desestimación le gana a «Ya pedidos».** Es la regla que se pidió —«lo
desestimé y no aparece más hasta que se mueva»— y es la más simple de explicar.
La otra lectura posible, que un RI abierto le gane porque «ya pedido» es más
informativo, deja al sistema contestando que no puede sacar algo de la lista; y
si se pidió igual, la desestimación ya no le estorba a nadie.

## Lo que quedó afuera, a propósito

- **`/inventario/stock` y `/inventario/articulos` no la miran.** Esas pantallas
  son el catálogo, no una propuesta: muestran todo y ofrecen pedir. Lo que se
  pidió es que no **sugiera**, y la que sugiere es «Para reponer».
- **No hay aviso ni push.** Desestimar no espera la decisión de nadie.
- **No se audita.** Se deshace con un click desde la misma pantalla, y la fila
  guarda quién fue y cuándo. La `auditoria` del núcleo es para lo que no vuelve.
- **No va a ninguna planilla.** En Inventario manda la planilla sobre el stock y
  los movimientos; desestimar no toca ninguno de los dos y es un concepto que
  sólo existe en el SdG, como los ensayos de Calidad. Si algún día la planilla
  gana una columna para esto, la regla de «toda ruta que toque un campo que se
  exporta tiene que exportar» empieza a valer.
- **Una fila por artículo, sin historial.** Volver a desestimar pisa la anterior
  con el `ultimo_movimiento` nuevo, que es justamente lo que reinicia el reloj.
- **El motivo es opcional.** Obligarlo es la forma más rápida de llenar la tabla
  de «x»; la pantalla dice «sin motivo» cuando no hay, porque un blanco se lee
  como «nadie sabe» y esto dice «nadie lo escribió».

## Dónde vive

| | |
|---|---|
| La decisión pura | [lib/inventario/desestimar.ts](../../../lib/inventario/desestimar.ts) |
| El tercer grupo | `clasificarParaReponer` en [lib/inventario/reponer.ts](../../../lib/inventario/reponer.ts) |
| La ruta | `app/api/inventario/faltantes-desestimados` |
| La pantalla | `app/(app)/inventario/reponer` |
| La tabla | `supabase/migrations/20261126093237_inventario_desestimar_un_faltante.sql` |

## Lo que falta

**La migración no está aplicada**: la aplica una persona en el editor SQL de
Supabase. Hasta que eso pase, la lectura de la tabla cae en su
`.catch(() => [])` y la pantalla se comporta igual que el día anterior —ningún
artículo aparece desestimado y el botón contesta error—. Esa red está puesta a
propósito: sin ella la pantalla entera dejaría de abrir por una tabla que
todavía no existe.

Tampoco se abrió en un navegador: está detrás del login.
