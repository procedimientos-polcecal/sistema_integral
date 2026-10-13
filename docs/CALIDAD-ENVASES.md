# Envases — el stock de bolsas y bolsones

Calidad lleva además una planilla de **stock de envases** —bolsas, bolsones y
mallas—, y desde el 16/09 vive acá como sección: `/calidad/envases`,
`lib/calidad/envases/`, tablas `calidad_envases_*`. El diseño está en
[el spec](superpowers/specs/2026-09-15-produccion-envases-design.md) y el paso a
paso en [el plan](superpowers/plans/2026-09-15-produccion-envases.md).

**Lo único que hay que saber antes de tocarla: acá manda la planilla.** Al revés
que la otra mitad de Calidad, donde la planilla de carbonilla se va porque las
entradas salen de Odoo y de la balanza. Su planilla es la del almacén clonada —mismos
nombres de pestaña, mismo stock por fórmula sobre el kardex—, así que el SdG lo
**lee** y no lo calcula, y el espejo es de ida y vuelta como en Inventario. Un
movimiento cargado en la app que no llega a la planilla **no existe**: la
próxima sincronización lee el stock de la fórmula, que no lo incluye, y revierte
el número. Por eso el espejo se espera y no corre en segundo plano.

Usa `tiene_acceso_calidad()`, `puede_editar_calidad()` y `es_admin_calidad()`,
las mismas que la carbonilla: un solo permiso para todo lo que lleva el sector.
Vivió un día adentro de Producción —ver [PRODUCCION.md](PRODUCCION.md)— y la
migración `20260916093203` es la mudanza.

Cuatro cosas que no se deducen del código:

- **La columna K del kardex no tiene encabezado.** Es una `ARRAYFORMULA` en `K2`
  que clasifica el código en grupo de envase, y es la única columna que el
  parser lee por posición. Por eso lleva guarda: si lo que sale es un número o
  una fecha, la columna está corrida y el grupo queda en null.
- **`ROTURA` y `DESPACHO` se guardan y no descuentan stock**, igual que la
  planilla. No se derivan de `SALIDAS`: medido, en 950 de 1.309 filas no cierran
  y en 133 hay despacho con salida en cero. Son tres números independientes.
- **El informe por período del SdG da distinto al de la planilla, a propósito.**
  La planilla agrupa con comodines sobre la descripción y cuenta los bolsones
  nuevos dos veces; el SdG agrupa por la K. La diferencia está explicada en la
  pantalla para que no se lea como un bug propio.
- **Sacar un artículo de la planilla lo da de baja en el SdG.** Hasta el
  13/10/2026 no: la sincronización sólo hacía `upsert`, así que un renglón
  borrado del listado seguía apareciendo en Stock para siempre y no había forma
  de darlo de baja desde ninguna pantalla. Ahora se marca `activo = false` lo
  que la planilla ya no trae, y el botón de traer dice **qué códigos** se dieron
  de baja. Se desactiva y no se borra: un artículo con kardex no se puede borrar
  —`on delete restrict`— y tampoco conviene, porque el movimiento viejo perdería
  de qué era. Si el artículo vuelve a la planilla, vuelve solo.

  Al que sobra se lo reconoce por la **marca de tiempo** de la corrida y no por
  una lista de códigos: un `.not("codigo", "in", …)` arma una URL que PostgREST
  rechaza sin decir por qué cuando la lista crece.

- **El stock de seguridad es de un GRUPO, no de un artículo.** En el listado esa
  columna está en **celdas combinadas** que abarcan varias filas, y el faltante
  compara el mínimo contra la **suma** de todas ellas: lo que importa es cuántos
  bolsones de 1,20 hay, sin importar de qué proveedor sea cada uno. Medido el
  13/10/2026, los tres bloques y lo que dice la planilla:

  | bloque | artículos | suma | mínimo | falta |
  |---|---|---|---|---|
  | `G10:G18` | 2,10 + 1,90 | 905 | 2000 | 1095 |
  | `G19:G25` | 1,20 + 1,40 | 1192 | 1500 | 308 |
  | `G26:G27` | 1,20 nuevos | 600 | 500 | 0 |

  Las bolsas (filas 2–9) **no** están combinadas: cada una tiene su mínimo. Por
  eso la regla no es "todo va por grupo" sino que **el grupo lo define la
  combinación**, y un artículo suelto es un grupo de uno — así la cuenta es una
  sola y no hay caso especial.

  El grupo se guarda en `grupo_seguridad` (el código del primer artículo del
  bloque) y **no sale de `grupo`**, la columna K del kardex, aunque hoy casi
  coincidan: el `00011` no tiene movimientos, así que no tiene K, y sin embargo
  está adentro del bloque de 2,10. Usar la K lo habría dejado afuera de su propia
  suma.

  La cuenta vive en `lib/calidad/envases/seguridad.ts` y no en una columna
  generada, porque una columna generada sólo ve su propia fila. La pantalla lo
  muestra con `rowSpan`, que es lo mismo que la celda combinada.

- **El espejo escribe la fecha en ISO**, y eso se decidió midiendo las tres
  formas contra la planilla real el 16/09/2026:

  | lo que se escribe | cómo queda |
  |---|---|
  | `46281` (el serial) | valor correcto, **formato borrado**, se ve `46281` |
  | `16/9/2026` (texto d/m) | queda bien, **pero lo parsea el locale** |
  | `2026-09-16` (ISO) | valor correcto, `DATE:d/M/yyyy`, se ve `16/9/2026` |

  El serial parecía lo correcto —es lo que pide `lib/core/fechaDeSheets.ts`— y
  no lo es acá: `escribirCeldas` manda `USER_ENTERED`, y con eso Google
  **reemplaza el formato de la celda** por el que infiere de lo que entró. Un
  número deja la celda sin formato aunque la columna entera sea de fechas. El
  ISO no se interpreta en ningún locale y deja el formato bien; probado con un
  día ≤ 12, que es donde un locale al revés mentiría en silencio.

Al 16/09/2026, la carga inicial dejó 28 artículos, 1.404 movimientos, 16
proveedores —los 16 enganchados al catálogo del núcleo—, 5 colores de referencia
y 3 líneas de historial. Tres artículos quedan sin grupo porque no tienen ningún
movimiento: el `00011` y dos restos del almacén (`00966` y `00967`) que quedaron
al clonar la planilla. Aparecen en una fila "Sin grupo" en vez de desaparecer.
