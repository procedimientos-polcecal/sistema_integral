# El resumen diario dice lo que se movió, no lo que hay — diseño

**Fecha:** 18/10/2026
**Estado:** implementado y verificado en producción el 19/10/2026
**Antecede:** [la app instalable](2026-10-16-app-instalable-design.md) (el resumen
diario) y [los avisos al instante](2026-10-18-avisos-al-instante-design.md).

## El problema

El resumen diario cuenta **stocks**: «23 órdenes de trabajo atrasadas», «11
requerimientos esperando aprobación», «15 equipos sin ningún service». Un stock
casi no se mueve de un día para el otro, así que **el push de mañana dice lo
mismo que el de hoy**. Una notificación que repite el mensaje enseña a
ignorarla, y después no hay forma de usarla para nada.

La prueba de que eso ya pasó: de las 13 personas, las dos únicas que probaron
las notificaciones en serio —Bernardo Strupp y Delfina Puch— tienen **los 13
avisos descartados**. Descartar es la única defensa que hay contra un mensaje
que se repite, y la usaron entera.

## Lo medido (18/10/2026, contra producción)

Corriendo `avisosDeUsuario()` de verdad para los 13 usuarios activos:

| | |
|---|---|
| Líneas de aviso por día, sumando a todos | 53 |
| De ésas, de ritmo —que por definición sólo cambian cuando alguien carga algo— | 30 |
| El que más recibe (Nicolás Lenzetti) | 11 en un solo push |
| Personas con notificaciones prendidas | 1 |
| Lo que esa persona recibe, por sus descartes | 0 |

Y cuánto se mueve de verdad lo que el resumen cuenta:

- **«Requerimientos esperando aprobación»**: en los últimos 14 días hubo
  **4 días con 0 entradas y 0 salidas** — el 11, 12, 17 y 18 de octubre—. Esos
  días el push fue idéntico al anterior, palabra por palabra. (Medido directo
  sobre `created_at` y `compras_historial`; la reconstrucción del número de cada
  día pasado es aproximada, el conteo de entradas y salidas no.)
- **«Facturas en el buzón sin vincular: 1»**: esa factura entró el **05/10**.
  Trece días diciendo lo mismo.
- **«Equipos sin ningún service: 15»**: hay **un solo service registrado en
  todo el sistema**. El número no baja salvo que alguien cargue uno, cosa que
  pasó una vez.
- **«Órdenes de trabajo atrasadas: 23»**: **19 tienen más de 7 días** y la más
  vieja es del **11/12/2025**, diez meses.

O sea que el resumen diario no es un resumen diario: es una foto de un depósito
que se vacía despacio, mandada todas las mañanas.

## La regla

> **El resumen diario dice lo que se movió desde el resumen anterior. La
> campana sigue mostrando lo que hay.**

Son dos cosas distintas y hasta ahora eran la misma:

| | Qué muestra | Para qué |
|---|---|---|
| **La campana** (en la app) | el stock: «23 atrasadas» | entrar a mirar el depósito cuando uno quiere |
| **El push diario** | el movimiento: «3 se atrasaron ayer» | enterarse sin entrar |

Con eso, un aviso **no se puede acumular**: aparece el día que se mueve y se va
solo al día siguiente. No hay nada que descartar, porque nada se queda.

Y los días quietos no se manda nada, que ya es la regla de hoy: cero movimiento
es cero push. Con los números de arriba, eso son varios días por semana en
silencio — y ese silencio es lo que le devuelve el valor al día que sí suena.

### Cómo se sabe qué se movió

Una foto diaria de los conteos. Los conteos **son globales** —`avisosDeUsuario`
los saca con `count` sobre las tablas y lo único que cambia por persona es qué
módulos ve—, así que alcanza con **una fila por aviso y por día**, no una por
persona: trece filas diarias, unas cinco mil al año.

La escribe el mismo cron de las 11:30 que ya manda el resumen, después de
mandarlo. El primer día no hay con qué comparar: no se manda nada y sólo se
guarda la foto.

### Sólo lo que sube

Si «OT atrasadas» pasa de 23 a 20, eso es una buena noticia y **no se avisa**.
El push es «esto apareció y te toca», no un registro de cambios. Avisar las
bajas duplicaría el volumen para decir cosas que no piden nada.

### Y los de ritmo se arreglan solos

«Trituración: hace 18 días que no se carga» tiene como `cantidad` cuántos
umbrales lleva sin cargarse. Con la regla del movimiento, ese aviso aparece
**el día que cruza un umbral nuevo** y no todos los días — que es exactamente lo
que esa cantidad quiso decir siempre. Los 30 de ritmo pasan a sonar unas pocas
veces por mes en vez de 30 veces por día.

### Una vez por semana, lo que sigue ahí

El riesgo de contar sólo el movimiento es que **el depósito se pudre en
silencio**: una OT del 11/12/2025 no vuelve a nombrarse nunca más. Así que un
día por semana —el lunes— el push lleva los totales, como hoy.

Es la contracara exacta del problema: diario es movimiento, semanal es lo que
hay. Y una vez por semana un mensaje que se parece al de la semana pasada no
cansa a nadie.

## Lo que se arregla de paso, porque es un error y no un volumen

«Requerimientos esperando aprobación» le llega hoy a **6 personas, y 3 no están
en `compras_aprobadores`**: Enzo Canesa, Karen Shtefec y Nicolás Rossi no pueden
aprobar nada. Pedirle a alguien que haga algo que no puede hacer enseña que un
aviso tuyo puede no ser tuyo, y eso vale aunque el aviso sea un delta.

El dato ya existe y la campana no lo mira: **si un aviso tiene una lista de
responsables, manda la lista**. Son los dos de aprobación —`compras_aprobadores`
y `os_aprobadores`—, que es la misma regla que ya usa el aviso al instante.

**Los administradores siguen recibiendo todo lo demás**, decidido a pedido el
18/10/2026. No se reparte por nivel de permiso ni se agrega una preferencia por
módulo: con el resumen contando movimiento, el volumen de Nicolás baja solo, sin
que nadie tenga que configurar nada.

## Qué hacer con los descartes que ya están

Bernardo y Delfina tienen 13 descartes cada uno, y `filtrarDescartadas` sólo
devuelve un aviso cuando el número **crece** — un conteo quieto queda oculto
para siempre. Con el push contando movimiento, esos descartes ya no lo afectan,
pero **siguen vaciándoles la campana**.

Se borran los 26 al aplicar esto, y se dice por qué: fueron la defensa contra un
problema que deja de existir. Es DML, así que lo puede aplicar un agente.

## Goals / non-goals

**Goals**

- Que dos resúmenes seguidos no puedan decir lo mismo.
- Que un día sin movimiento sea un día sin push.
- Que el backlog no desaparezca de la vista: la campana siempre, el push los
  lunes.
- Que la comparación entre un día y el anterior sea una función pura con tests.

**Non-goals**

- No se toca qué avisos existen ni cómo se cuentan: `lib/home/avisos.ts` y los
  conteos de `avisosDeUsuario()` quedan igual. Esto es **cuándo se dice**, no
  **qué se cuenta**.
- No se toca el aviso al instante, que ya cuenta eventos y no estados.
- No se reparte por nivel de permiso, ni hay preferencia por módulo. Los
  administradores reciben todo.
- No se avisan las bajas.

**Anti-goals**

- Que algo que importa deje de nombrarse nunca más por haber dejado de moverse.
  El recordatorio de los lunes es la defensa, y si se saca, el diseño pierde su
  red.
- Que la foto diaria se desincronice y el delta mienta. Un delta mal calculado
  es peor que un stock repetido: el stock al menos es verdad.

## Lo que queda a criterio de quien lo implemente

- La forma de la tabla. Lo mínimo es `(fecha, notificacion_id, cantidad)` con
  la fecha en hora de Argentina, que es la que define «el día». **Pide
  migración**, o sea que la aplica una persona a mano.
- Qué pasa si el cron no corre un día: la comparación tiene que ser contra **la
  última foto que haya**, no contra «ayer», o el día que Vercel falle el delta
  sale al doble o sale vacío.
- Cómo se redacta cada línea en movimiento. «3 · Órdenes de trabajo atrasadas»
  pasa a querer decir «3 nuevas», y el texto tiene que decirlo sin ambigüedad —
  si no, un 3 que antes era el total y ahora es el delta es peor que cualquiera
  de los dos.
- Si el día del recordatorio semanal se fija en el código o se configura. Por
  defecto, el lunes.


---

## Cómo terminó (19/10/2026)

Implementado y verificado contra producción. La tabla `avisos_fotos` se aplicó
el 19/10 y el cron de las 11:30 UTC corrió por primera vez con ella viva.

**La primera corrida cayó lunes, que es el caso que casi se pierde.** Sin foto
previa y siendo lunes, `queMandarHoy` devolvió `"totales"` y el push salió:
«11 cosas para mirar». Con la primera versión del código —que cortaba por
«primer día» antes de mirar el día de la semana— no habría salido nada y el
primer recordatorio habría sido el lunes siguiente. Lo encontró la revisión del
branch, no los tests.

Después de esa corrida la tabla quedó con las 11 filas de la foto, fechadas
2026-10-19, idénticas a lo que la simulación había predicho.

**La idempotencia quedó probada de verdad y no por razonamiento**: con la foto
de hoy ya escrita, `queMandarHoy` devuelve `"nada"`, así que un reintento del
cron o un disparo a mano no mandan un segundo push.

### Lo que la revisión encontró, y que los tests no

Cuatro, y los cuatro del tipo que no rompe nada visible: mandan el mensaje
equivocado.

1. **Si fallaba la segunda consulta de `ultimaFoto`, el delta mentía.** Con la
   fecha resuelta y las filas caídas, la foto volvía vacía pero con fecha, así
   que no era «primer día» y todo contaba como nuevo: cada número habría salido
   como el stock entero rotulado de delta —«23 más · Órdenes de trabajo
   atrasadas»—. Era el anti-goal textual de este documento.
2. **Un día sin avisos no dejaba marcada la fecha**, así que el delta del día
   siguiente se comparaba contra una foto vieja y más alta. Se escribe una fila
   centinela.
3. **Los lunes el cron no era idempotente**: los totales no miran la foto.
4. **El primer día en lunes perdía el recordatorio de esa semana.**

Los dos últimos se arreglaron juntos sacando la decisión de la ruta a
`queMandarHoy`.

### Lo que queda pendiente

- **Si el cron no corre un lunes, el recordatorio no se repone** y el backlog
  queda 14 días sin nombrarse. Arreglarlo pide saber cuándo fue el último
  recordatorio, que es estado que este diseño no tiene.
- El cron paga **una pasada extra** de los 13 conteos para armar la foto,
  después del bucle por persona. Es costo y no corrección; el presupuesto de
  una función de Vercel es de 300 s.
- **Falta ver el primer resumen de movimiento de verdad**, que es el del martes
  20/10: hasta ahora sólo se probó la rama de los totales.
