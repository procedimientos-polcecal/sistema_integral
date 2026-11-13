# El semáforo de pedidos y el reclamo a Compras

**Fecha:** 12/11/2026 · **Módulo:** Compras, en la pantalla `/mis-pedidos`

## Para qué existe

Quien pide un material no sabe en qué anda su pedido. Lo que arrancó esta
conversación fue un caso concreto: Mantenimiento no puede cerrar una OT porque
le falta un repuesto, llama para preguntar cuándo llega, y nadie se lo puede
contestar.

Hoy `/mis-pedidos` muestra dos chips con el estado de cada pedido. Eso dice
*dónde está* pero no *hace cuánto*, y sobre todo no dice **si eso es normal o
está dormido**. El área no tiene forma de decidir por cuál de sus pedidos
conviene reclamar.

Lo que se construye es eso: un semáforo que ordena por urgencia real, y un
botón que convierte «mirar el rojo» en «pedirle a Compras que explique».

**La acción que el semáforo tiene que habilitar está decidida y es ésta:** el
área le pide a Compras una justificación del atraso. No es un tablero para
mirar.

## Lo que se midió antes de diseñar, y que cambió el diseño tres veces

Estos números son del 11 y 12/11/2026 contra la base de producción. Están acá
porque cada uno descartó una versión de esta misma pantalla.

**1. El eje que se pidió, solo, no discrimina.** Sobre los 546 RI abiertos,
días desde la fecha de requerimiento:

| | |
|---|---|
| 0 a 7 días | 14 · **3%** |
| 8 a 15 | 47 · 9% |
| 16 a 30 | 75 · 14% |
| 31 a 60 | 150 · 28% |
| 61 a 120 | 178 · 33% |
| más de 120 | 70 · 13% |

Mediana **54 días**. Un semáforo sobre los 546 está en rojo casi entero, y un
semáforo siempre rojo no lo mira nadie — que es exactamente lo que ya le pasó a
la prioridad de este módulo: **42% de los abiertos dice URGENTE**.

**2. El eje alternativo es peor.** Contra `fecha_necesidad` —cargada en 539 de
540— el **91% ya está vencido**. El margen mediano entre pedir y necesitar es
de **4 días**: la gente escribe «lo necesito ya», así que esa fecha no ordena
nada.

**3. Lo que sí parte la lista en dos es de quién depende.** De los 546
abiertos, **419 ya están en PEDIDO** —la demora es del proveedor y Compras ya
hizo lo suyo— y **127 esperan que Compras actúe**. Reclamarle a Compras por los
419 es pedirle que justifique algo que no maneja.

**4. Y adentro de esos 127 hay 20 que no son reclamables.** Están en
`EN_ESPERA`, que no es una etapa sino un desvío: un pedido frenado a propósito.
**9 de los 10 más viejos de la lista son de ésos.** Sin excluirlos, lo primero
que ve el área arriba de todo son pedidos que alguien congeló, y el primer
reclamo que salga se contesta con «ése está en espera» — que es como esta
función se muere en la primera semana.

Quedan **106 pedidos reclamables**, y es sobre ésos que pinta el semáforo.

## Lo que ya está construido y no hay que volver a hacer

**El reclamo existe desde el 11/11/2026.** La mensajería interna ya está
montada sobre un requerimiento de compra: `ENTIDADES.requerimiento` en
[lib/mensajes/entidades.ts](../../../lib/mensajes/entidades.ts), con su ruta
apuntando a `/mis-pedidos?pedido=…`, y `/mis-pedidos` ya tiene un
`BotonDeMensajes` por pedido que abre el hilo.

Eso importa por dos motivos:

- **El canal llega.** La mensajería avisa **por correo y no por push**, medido
  antes de construirla: el push llega a 1 de 14 personas y el correo a 14 de
  14.
- **La respuesta queda pegada al RI.** Es lo que convierte un reclamo
  telefónico —que hay que repetir cada vez que alguien pregunta— en algo que el
  área lee sin volver a preguntar.

Así que **«Reclamar» no es un circuito nuevo**: es el hilo que ya existe,
abierto con el texto escrito y los destinatarios puestos.

## Qué se construye

### El semáforo

Va en `/mis-pedidos`, y es **la franja de resumen más el punto por renglón**
(elegido mirando los dos por separado y las dos juntas).

- **Arriba de la lista**, tres chips con el conteo: verde, amarillo, rojo.
  **Tocar un chip filtra la lista** a ese color.
- **En cada renglón**, un punto del color que le toca, y los días que lleva
  esperando.

**Los cortes son 30 y 90 días**, sobre la fecha de requerimiento:

| Color | Significa | Cuántos hay hoy |
|---|---|---|
| Verde | hasta 30 días | 56 · 53% |
| Amarillo | 31 a 90 días | 35 · 33% |
| Rojo | más de 90 días | 15 · 14% |

Se eligieron mirando el reparto real contra el juego alternativo de 10/30, que
dejaba 50 en rojo y a Mantenimiento abriendo la pantalla con 33 reclamos
posibles. Con 30/90 Mantenimiento abre con **11**, que es una lista que una
persona puede recorrer en una mañana. **El rojo tiene que costar poco de
atender o deja de significar algo.**

**Qué entra en el semáforo**, y es la decisión que más lo define: sólo los RI
**abiertos, no pedidos y no en espera**. O sea, ni `RECIBIDO`, ni `DENEGADO`,
ni `PEDIDO`, ni `EN_ESPERA`, ni los de aprobación `DENEGADA`. Un pedido que ya
salió no se reclama acá: para eso está la orden de compra con su fecha estimada
de recepción, que se informa al área y que el usuario está construyendo por
separado.

**Los pedidos que no entran siguen listándose igual, sin punto.** La pantalla
no esconde nada: el semáforo es una capa sobre la lista de siempre.

### El botón de reclamo

En los renglones amarillos y rojos, un botón **Reclamar** que abre el hilo de
mensajes que ya existe, con el texto ya redactado — el número de RI, los días
que lleva, el estado en que está, y la pregunta.

El texto es **editable antes de enviar**: es un borrador, no un formulario.
Quien reclama puede agregar el contexto que el sistema no sabe.

**No hay un estado «reclamado» nuevo.** El hilo del RI ya es el registro de que
se reclamó y de qué contestaron; agregar una columna sería una segunda fuente
de verdad sobre lo mismo.

### A quién le llega el reclamo

**A los usuarios con grant `edicion` o `admin` en el módulo Compras**, leído de
`usuario_modulos`. Decidido el 12/11/2026. Hoy son **cuatro**: Maximiliano
Lenzetti, Nicolás Lenzetti, Bernardo Strupp y Facundo Ortiz, las cuatro con
correo cargado.

Dos cosas medidas ese día que hay que saber antes de tocarlo:

- **Es el grant explícito y no el nivel efectivo.** `nivelEnModulo()` le
  devuelve `admin` a todo `admin_sistema` sin mirar el grant, así que por ahí
  entraría una quinta persona que en Compras tiene `lectura` explícita. Usar el
  nivel efectivo repetiría el error que ya se pagó con `compras-por-aprobar`,
  que le llegaba a 6 personas de las cuales 3 no podían aprobar. **Si alguien
  cambia esto a `nivelEnModulo()`, el reclamo le empieza a llegar a gente a la
  que alguien le dio lectura a propósito.**
- **Hoy esos cuatro son exactamente los de `compras_aprobadores`**, así que no
  hace falta una tabla nueva. Pero son dos listas distintas por definición
  —aprobar el gasto y gestionar la compra son roles separados en este módulo— y
  pueden divergir mañana. La fuente es el grant, no la lista de aprobadores.

**Lo que queda sabido y sin resolver:** 5 de los 106 están en
`estado_aprobacion = PENDIENTE`, o sea esperando a un aprobador y no a Compras.
Como hoy las dos listas coinciden, el reclamo igual le llega a quien decide; el
día que dejen de coincidir, esos pedidos le reclaman a quien no puede
contestar.

### El alcance: qué pedidos cuenta el semáforo

`/mis-pedidos` ya muestra los pedidos **del área de quien mira**
(`usuario_areas_compras`) y tiene un alcance «todos». **El semáforo cuenta
exactamente lo que la lista está mostrando** — si el alcance cambia, los
números cambian con él. Dos números distintos en la misma pantalla sobre el
mismo filtro es la clase de cosa que hace que nadie confíe en ninguno.

### El orden de la lista

`/mis-pedidos` ordena hoy por número de RI descendente, 50 por página, y eso
**no cambia**. Pero **al tocar un chip, la lista filtrada se ordena por
antigüedad**, del más dormido al más nuevo.

El motivo está medido y es lo que casi deja al semáforo en decoración: para
Mantenimiento —1.125 pedidos, 23 páginas— los 11 rojos caen en las páginas 5,
6, 7, 11, 12 y 15, y los amarillos en la 2, 4 y 5. **La página 1 no tiene un
solo punto de color.** Con el orden de siempre, el punto por renglón no se ve
nunca en la vista por defecto y todo el valor pasaría por el chip.

No se cambia el orden por defecto porque la pantalla tiene otro uso declarado
—mirar si alguien ya pidió lo mismo— y eso se navega por número. Ordenar por
antigüedad **sólo con filtro activo** deja las dos cosas: la vista de siempre
para quien entra a pedir, y el rojo ordenado por urgencia para quien entra a
reclamar.

### Qué muestra el renglón de un reclamo ya hecho

El renglón dice **cuándo se reclamó por última vez**, leído del hilo de
mensajes. No hay estado nuevo: el hilo ya es la fuente de verdad, y esto es
sólo mostrarlo.

Sin eso, las mismas 11 filas rojas se reclaman un día sí y otro también, y los
quince usuarios que miran con alcance «Todos» reclaman los mismos quince rojos
— cuatro personas recibiendo el mismo correo repetido es, textualmente, cómo
este sistema ya documentó que mueren sus notificaciones.

**Y el botón aparece sólo en los pedidos del área propia.** En el alcance
«Todos» se ven los de las demás áreas, con su punto de color, pero sin botón:
reclamar por el pedido de otro es ruido para Compras y no ayuda a nadie.

### Qué cuentan los tres chips

**El conjunto filtrado completo, no la página.** La lista está paginada en el
servidor, así que son conteos aparte. Contar sólo las 50 de la página haría que
el número dijera algo que no le sirve a nadie: lo que se quiere saber es
cuántos hay, no cuántos entraron en esta pantalla.

## Lo que queda explícitamente afuera

- **Los 419 ya pedidos.** Los cubre la orden de compra con fecha estimada, que
  es trabajo aparte y en curso.
- **Un push.** El reclamo lo inicia una persona mirando la pantalla; no hay
  nada que interrumpir. Y la mensajería ya decidió que su canal es el correo.
- **Un aviso en `lib/home/avisos.ts`.** Agregar uno lo manda a la campana **y**
  al push de todos, y «tenés 15 pedidos en rojo» no se mueve de un día para el
  otro: es justo el aviso que la gente descarta. El spec de los avisos
  instantáneos ya tiene la lista de candidatos rechazados y éste entra ahí.
- **Cambiarle el criterio a la prioridad.** Que el 42% diga URGENTE es un
  problema real y conocido, pero es una conversación con los usuarios, no
  código.

## Decisiones que quedan para quien construya

- Dónde viven los cortes: una función pura en `lib/compras/`, con tests, usada
  por la pantalla. Los dos números en un solo lugar.
- Cómo se consiguen los tres conteos sin castigar la carga de la pantalla: tres
  `count: exact, head: true` o un RPC. Lo que no es opción es contar la página.
- `HiloDeMensajes` hoy no recibe texto ni menciones iniciales. Esa firma nueva
  la define quien construya.
- Si el punto va antes o después del número de RI, y cómo se ve la franja en
  343 px de ancho — tres chips entran, tres tarjetas no.
- El texto exacto del borrador del reclamo.

## Lo que no se puede comprobar sin una persona

La pantalla está detrás del login, así que lo que se verifica con tests es la
función que decide el color y la que cuenta la franja. **Que el filtro por chip
y el botón de reclamo hagan lo que dicen hay que mirarlo en producción**, con
un RI real, la primera vez.

## Un dato sucio que apareció midiendo

Hay un requerimiento con `fecha_necesidad` corrupta: da **−657.435 días** de
margen contra su fecha de pedido. No afecta a este diseño —el semáforo no usa
esa columna— pero conviene arreglarlo antes de que alguien construya algo que
sí la use.
