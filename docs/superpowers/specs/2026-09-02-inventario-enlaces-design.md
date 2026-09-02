# Inventario se conecta con Mantenimiento y con Compras

Diseño acordado el 2 de septiembre de 2026. Cierra la serie: los
[cimientos](2026-09-02-inventario-cimientos-design.md) y las
[pantallas y el espejo](2026-09-02-inventario-pantallas-y-espejo-design.md).

Dos enlaces, un reloj y una corrección.

## 1. Mantenimiento lee la base, no la planilla

El autocompletado de repuestos de una OT y la consulta de disponibilidad pasaban
por `leerValores` sobre el Sheets. Ahora consultan `inventario_articulos`.

Gana tres cosas: es rápido, no depende de que Google conteste, y **el buscador
deja de fallar en silencio**. Antes, si la planilla no estaba configurada, el
endpoint devolvía `{ configurado: false, data: [] }` y la pantalla hacía
`setSugerencias(body.data ?? [])`: escribías y no aparecía nada, sin forma de
distinguir "no hay ningún repuesto así" de "no se pudo consultar". Ahora el
aviso se muestra.

Pierde una cosa, y hay que decirla: **el número ya no es de este segundo**, es
de la última sincronización. La documentación había elegido la lectura en vivo a
propósito —"el stock cambia cada vez que alguien retira algo"—. Por eso este
tramo trae el reloj, y por eso viaja `sincronizado_en`.

### La corrección: cero no es lo mismo que sin informar

La pantalla de repuestos distingue cuatro estados, y dos de ellos son **cero**
("no hay") y **sin informar** ("nadie lo contó"). Su propio comentario explica
por qué importa: mostrar un vacío como cero manda a comprar algo que puede
estar. `estadoDe()` devuelve `sin_dato` cuando el stock es `null`.

Pero en los cimientos decidí que `stock_actual` fuera `not null default 0` —el
RPC hace aritmética con él— y que el parser cayera a cero con la celda vacía.
Leyendo la base, esa rama no se habría dado nunca: **la distinción se perdía en
silencio.**

Se arregla guardando las dos cosas (migración 048): `stock_actual` para operar y
**`stock_planilla`** con lo que decía la celda, `null` incluido. El endpoint
devuelve `stock = stock_planilla === null ? null : stock_actual` — el número
fresco cuando alguien contó, y `null` cuando no.

## 2. El reloj

`/api/cron/inventario-sync`, con los dos relojes de siempre: **GitHub Actions
cada quince minutos**, que marca la frecuencia real, y el cron diario de
`vercel.json` como red. El plan Hobby no admite crons más seguidos que un día, y
poner una frecuencia mayor no degrada el cron: hace fallar el deploy entero.

Acá el reloj pesa más que en los otros módulos. En Compras o Mantenimiento un
espejo viejo se nota; acá, sin reloj, Mantenimiento consultaría un stock tan
viejo como el último botón apretado — o sea peor que antes, cuando leía el Sheets
en vivo. El reloj es lo que hace que el punto 1 sea una mejora y no un retroceso.

## 3. La entrada al pañol y su requerimiento

`inventario_movimientos.ri` ya guardaba el número que trae la columna A del
kardex. Ahora se suma `requerimiento_id`, resuelto contra
`compras_requerimientos.nro_ri` durante la sincronización. Lo que no se reconoce
queda en null y se informa —el resultado devuelve `ri_sin_requerimiento`—, con el
mismo criterio de la 032.

Los RI se buscan **de a 200**: un `.in()` con mil valores arma una URL que
PostgREST rechaza con un 400 sin decir por qué.

### La recepción se sugiere, no se decide

Una entrada al pañol con un RI **es la recepción de ese pedido**, y el
seguimiento de la recepción era el pendiente número 1 de `COMPRAS-ESTADO.md`.
`RECIBIDO` y `fecha_recepcion` existen desde la 017, y el PATCH del
requerimiento ya pone la fecha solo y exporta a la planilla: el botón salió
casi gratis.

Pero el sistema **no** marca el RI como recibido por su cuenta. Dos razones:

- **Una entrega parcial cerraría un pedido entero.** Un RI de 100 unidades que
  llega en dos tandas quedaría recibido con la primera.
- **Decidir que una compra está completa es de quien la recibió**, no de una
  coincidencia de números.

Así que el detalle del requerimiento muestra una sección "Entró al pañol" con lo
que se registró, y ofrece el botón. El texto lo dice sin vueltas: puede haber
venido sólo una parte, así que lo decide la persona.

## Tests

El agregado de este tramo es una regla nueva sobre el parser: un stock vacío es
cero para operar y `null` para saber si lo contaron, y un cero escrito sigue
siendo cero. Es la que sostiene la corrección de arriba.

Lo demás son enlaces y consultas, que no tienen lógica propia que testear: el
reconocimiento por nombre ya está cubierto en `enlaces.test.ts` y el armado de
las celdas del espejo en `espejo.test.ts`.

## Lo que queda afuera

**Reintentar un pendiente desde la pantalla.** Los movimientos que no llegaron a
la planilla se ven y se dice qué hacer con ellos; el botón que lo reintenta —como
`/api/compras/sheets/reintentar`— no está.

**El multi-depósito.** La planilla tiene stock por ubicación (PAÑOL, TALLER VIAL,
PRODUCCIÓN, MANTENIMIENTO, TALLER ELÉCTRICO) y acá se usa el consolidado, igual
que en el repo de origen. El modelo no lo bloquea.

**Dar de baja Neon.** Es un paso operativo, no de código.
