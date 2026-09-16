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
- **El espejo escribe la fecha como serial y no como texto**, a diferencia del
  de Inventario. Un texto lo interpreta la planilla según su locale, y eso ya
  dio vuelta 885 fechas en Compras. La columna H tiene formato `DATE:d/M/yyyy`
  hasta la fila 3296, así que el serial se ve como fecha igual.

Al 16/09/2026, la carga inicial dejó 28 artículos, 1.404 movimientos, 16
proveedores —los 16 enganchados al catálogo del núcleo—, 5 colores de referencia
y 3 líneas de historial. Tres artículos quedan sin grupo porque no tienen ningún
movimiento: el `00011` y dos restos del almacén (`00966` y `00967`) que quedaron
al clonar la planilla. Aparecen en una fila "Sin grupo" en vez de desaparecer.
