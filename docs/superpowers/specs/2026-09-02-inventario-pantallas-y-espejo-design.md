# Inventario — las pantallas y el espejo a la planilla

Diseño acordado el 2 de septiembre de 2026. Continúa
[los cimientos](2026-09-02-inventario-cimientos-design.md).

Eran dos specs —pantallas por un lado, escritura a la planilla por otro— y se
fusionaron. El motivo es una dependencia que apareció al diseñarlos.

## Por qué van juntos

Si se pudieran cargar movimientos antes de que la escritura a la planilla
exista, pasaría esto: el RPC baja el stock en la base, la sincronización lee la
planilla —que no tiene ese movimiento— y **revierte el stock**. El movimiento
queda registrado con origen `app` y su efecto desaparece sin que nada avise.

Es el bug silencioso que el spec anterior dejó documentado, y la conclusión es
que **cargar movimientos tiene que viajar con su escritura**. No son dos tramos:
es uno.

## El espejo

**Va por la cuenta de servicio, no por Apps Script.** El repo de origen usa un
Web App de Apps Script porque ese proyecto no podía usar una cuenta de servicio
—"bloqueada por la política de la organización"—. El SdG sí puede: la suya ya
escribe en cuatro planillas y **ya lee ésta**. Lo único que hace falta es que
esté compartida como **editor**, igual que las de OT, OS y comparativas.

**Nunca se escribe la columna G.** Es el saldo corriente del kardex y es una
fórmula: escribirla la rompe y con ella el stock de todo lo que viene abajo. El
Apps Script del repo de origen lo dice en su encabezado —"el script NO calcula ni
escribe el stock"— y acá vale igual. `celdasDelMovimiento` arma nueve celdas
—A, B, C, D, E, F, H, I, J— y hay un test cuyo único trabajo es comprobar que la
G no está entre ellas.

**La fila se busca por la columna B, no por la A.** La A es el N° de
requerimiento y viene vacía en la mayoría de las filas; buscar por ahí dejaría la
fila nueva en medio de los datos. Por eso `filaSiguienteSegunColumnaA` pasó a
llamarse `filaSiguienteSegunLaColumna`: la función siempre fue genérica y el
nombre mentía.

**Un ajuste se escribe como la diferencia.** La planilla no conoce el ajuste:
tiene una columna de entrada y otra de salida. Un ajuste va como el delta contra
el stock que había, para el lado que corresponda, que es lo que mantiene
coherente la fórmula del saldo. Es lo mismo que hacía el Apps Script.

## El fallo deja de ser silencioso

El repo de origen manda el espejo a `after()` —segundo plano— y su fallo termina
en un `console.warn`. Ni `sheets_row`, ni un flag, ni un pendiente: para
enterarse hay que ir a los logs de Vercel.

Acá el espejo **se espera**. Es un segundo más de demora a cambio de saber si lo
que cargaste existe, y con la planilla mandando esa diferencia no es cosmética.
Si falla:

- Se anota en `sheets_pendiente` con **lo que dijo Google, sin traducir**
  (migración 047). Un diagnóstico que no se distingue de otro no sirve — eso
  costó una tarde en Compras.
- La pantalla se lo dice a quien cargó, explicando la consecuencia: que la
  próxima sincronización lo va a revertir.
- El listado de movimientos los muestra arriba, aparte y en ámbar.

## Las pantallas

Cinco rutas bajo `/inventario`, en el shell del SdG. No se portan la pantalla de
usuarios —el SdG ya tiene Administración → Usuarios—, ni el Nav propio, ni la
PWA.

**Stock** (`/inventario`) — la que se abre en el celular parado frente al
estante. Buscador grande arriba, un filtro "sólo lo que falta", y cada artículo
legible de un vistazo. La búsqueda va **contra la base y no contra la planilla**:
leer 2.800 filas de Sheets en cada tecla sería lento y dependería de que Google
conteste.

**No sincroniza sola al abrirse**, a diferencia del origen. Allá era barato
—pedía sólo el stock a un webhook—; acá la sincronización lee las dos pestañas y
escribe unas 6.900 filas. Va con botón, con `UltimaSincronizacion` al lado, y el
resultado dice cuántos artículos y movimientos entraron y **qué nombres no se
reconocieron** contra el núcleo.

**Cargar movimiento** (`/inventario/movimientos/nuevo`) — el flujo móvil. Primero
qué artículo, después qué pasó con él. Antes de confirmar muestra **en cuánto va
a quedar el stock**, que es la comprobación que hace cualquiera antes de apretar,
y avisa si quedaría negativo. El proveedor y el N° de RI sólo aparecen en las
entradas, que es cuando significan algo.

**Movimientos** (`/inventario/movimientos`) — el kardex, con filtros por tipo,
origen, sector y período. `origen` es el filtro que importa: distingue lo cargado
en el sistema de lo que vino de la planilla, y sin eso no se puede saber si la
app se está usando.

**Artículos** (`/inventario/articulos`) — el catálogo. Se edita la descripción,
la ubicación y el stock de seguridad. **El stock no está entre lo editable**:
sale de las fórmulas de la planilla, y corregirlo a mano crearía un número que la
próxima corrida pisa sin avisar. Para cambiar cuánto hay se carga un ajuste, que
además deja constancia de quién lo contó. Los artículos nuevos tampoco se dan de
alta acá: nacen en la planilla, que es de donde salen los códigos.

## Tests

Sobre lo puro, que es donde están las decisiones:

- **Qué celdas se escriben**: que la G no esté nunca, que sean nueve, que cada
  dato caiga en su columna, y que lo vacío se escriba vacío en vez de omitirse
  —omitir dejaría el dato de la fila anterior—.
- **Entrada, salida y ajuste**: el ajuste hacia arriba, hacia abajo, y el que no
  mueve nada.
- **La fecha**: d/m/aaaa, que es como la lee la planilla.

## Lo que queda afuera

**El reloj.** La sincronización tiene botón pero todavía no cron. Cuando se
sume, va como los otros: GitHub Actions cada quince minutos y el cron diario de
Vercel de red, porque el plan Hobby sólo admite crons diarios.

**Reintentar un pendiente desde la pantalla.** Hoy se ven y se dice qué hacer;
el botón que lo reintenta es como el `/api/compras/sheets/reintentar` de Compras
y todavía no está.

**Los enlaces del spec 4**: que Mantenimiento lea `inventario_articulos` en vez
de la planilla, y que `movimientos.ri` se enlace a `compras_requerimientos`.
