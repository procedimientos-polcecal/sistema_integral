# Las planillas las llena el sistema

Acordado el 19 de octubre de 2026. **Invierte la dirección de los cinco espejos
donde hoy manda la planilla** —Compras, Mantenimiento, Inventario,
Calidad/Envases y Calidad/carbonilla— y, con eso, invierte también el
[spec del 13/10](2026-10-13-calidad-la-planilla-manda-design.md), que seis días
antes había dado vuelta carbonilla en la dirección contraria.

Lo que cambia respecto de aquel intento **no es el diseño: es que esta vez la
planilla se bloquea.** Esa es toda la diferencia, y es la que decide si esto
funciona o repite las 800 toneladas.

## El punto de partida, medido

Por dónde entra hoy la carga, al 19/10/2026:

| Módulo | Registros | De la planilla | Del sistema |
|---|---:|---:|---:|
| Compras (requerimientos) | 2.159 | 2.159 | **0** |
| Mantenimiento (OT) | 2.200 | 2.200 | **0** |
| Inventario (movimientos) | 4.584 | 4.583 | **1** |
| Calidad / Envases | 1.506 | 1.506 | **0** |
| Calidad / Carbonilla | 1.139 | 1.135 | **4** |
| **Total** | **11.588** | **11.583** | **5** |

**El 0,04% de todo lo que hay en estos cinco módulos se cargó en el SdG.** El
resto entró por una planilla o por un formulario de Google que escribe en una
planilla.

Eso es el riesgo entero de esta migración, y es por qué el intento de
septiembre con carbonilla falló: el diseño suponía que la gente iba a cargar en
el SdG, y la gente siguió cargando donde siempre. El stock quedó sumando
entradas sin restar nada **durante un mes**, y nadie lo notó porque un número
mal calculado no se distingue de uno bien calculado.

## Por qué esta vez sí

**Porque la planilla deja de aceptar escritura.** Un diseño que *pide* que
alguien cambie de costumbre da el número incorrecto hasta que la costumbre
cambie; un diseño donde la vieja costumbre **no es posible** no tiene ese modo
de fallar. Si alguien intenta cargar en la planilla, Google se lo impide en el
momento: no hay una versión silenciosa de ese error.

Y la condición que hace que esto sea razonable y no cruel: **los cinco módulos
ya tienen pantalla de carga en el SdG.** No hay que construirla, hay que
empezar a usarla. Eso se verificó antes de acordar esto.

## La forma final

- **La pestaña de datos de cada libro la escribe el sistema, entera, una vez
  por semana**, con el último estado. Deja de ser un registro que crece fila
  por fila y pasa a ser un artefacto generado.
- **El SdG deja de leer esa pestaña.** Se apaga el importador del módulo.
- **La pestaña queda protegida** y el único editor es la cuenta de servicio.
- **Lo derivado sigue derivando.** `KANBAN` e `IMPRESIÓN` cuelgan de `OT`; las
  nueve pestañas por área de `SEGUIMIENTO` son `FILTER` de `COMPRAS CON RI`; el
  stock de Envases y de Inventario es una fórmula sobre su kardex. Nada de eso
  se toca: si el sistema reescribe la pestaña de datos, lo derivado se recalcula
  solo. **Es la razón por la que esto se puede hacer sin rehacer las
  planillas.**

### Lo que el sistema NO escribe

**Las columnas de fórmula.** El stock de Inventario y el de Envases salen de un
cálculo sobre el kardex; el sistema escribe los movimientos y deja que la
fórmula los sume. Escribirlas rompe el cálculo y con él todo lo que está abajo
—está dicho desde siempre en el encabezado de
[lib/inventario/espejo.ts](../../../lib/inventario/espejo.ts)—.

Esto fue una preocupación al diseñar y resultó no serlo: el sistema ya escribe
esos kardex hoy, movimiento por movimiento, conviviendo con las fórmulas.

## Las cuatro trampas

### 1. ~~Una pestaña protegida rechaza a la cuenta de servicio~~ — probado el 19/10, y sale mejor

Proteger un rango no es quitarle el acceso a la gente: es dejar una lista de
quién puede editarlo. La pregunta era si la cuenta de servicio quedaba afuera.

**Probado contra un libro real, y la respuesta es que no sólo pasa: puede
administrarse la protección ella misma.**

| | |
|---|---|
| Protege, y escribe con la protección puesta | **sí**, HTTP 200 |
| Al crear la protección, ¿quién queda de editor? | el servicio **y** los administradores del archivo (`nicolaslenzetti@`, `procedimientos@`) |
| ¿Puede sacar a las personas y quedar sola? | **sí** — `editors = [sheets-reader@…]` |
| ¿Puede excluirse a sí misma? | **no**: `You can't remove yourself as an editor` |
| ¿Puede quitar la protección? | sí |

Eso cambia el plan para mejor: **no hace falta tocar nada a mano, pestaña por
pestaña.** La bajada de cada módulo puede poner su propia protección al
terminar de escribir, dejándose como única editora. Y que no pueda excluirse a
sí misma es, acá, una garantía: no existe la forma de dejar una pestaña que el
sistema tenga que escribir y no pueda.

**Lo que falta confirmar, y lo tiene que hacer una persona:** que alguien que
*no* está en la lista efectivamente quede bloqueado al escribir desde la
pantalla de Sheets. Es la mitad que no se puede probar con una cuenta de
servicio.

Quedó un libro listo para eso, con la primera pestaña protegida y el servicio
como único editor:
[PRUEBA PROTECCION](https://docs.google.com/spreadsheets/d/1neEDekcdPvCRiNOxibrkoD6EnWMMiL3nVX1mWpYXwiI/edit).
Abrirlo y tratar de escribir en `A1` contesta la pregunta.

**Y la sospecha que hay que despejar ahí**: el dueño de un archivo, y en una
unidad compartida quien la administra, suele poder editar igual aunque no esté
en la lista. Si eso pasa, la protección frena a la mayoría pero **no al dueño de
cada planilla**, que es justamente quien más las edita. De ese resultado depende
si el bloqueo alcanza o si además hay que bajar a esas personas a *Lector*.

### 2. El importador y la bajada no pueden convivir

Si la bajada se enciende y el importador sigue corriendo, el SdG lee su propia
salida. Peor: desde el 18/10 la sincronización **borra** lo que la planilla
dejó de tener, así que una bajada que no alcanzó a escribir una fila se leería
como una orden de borrado.

**Por módulo, es un solo movimiento**: se apaga el importador y se enciende la
bajada en el mismo deploy. No hay un estado intermedio sano.

### 3. Los dos formularios de Google

Compras y Mantenimiento no se cargan en la planilla a mano: tienen un
formulario de Google que escribe en ella. De los últimos 400 requerimientos,
**397 entraron por ahí**.

Bloquear la planilla no apaga el formulario — Forms escribe en su hoja de
respuestas aunque esté protegida para humanos. Hay que **apagar el formulario**
y avisar a quien lo use, el mismo día. Mientras el formulario siga vivo, hay dos
fuentes y la bajada semanal pisa lo que el formulario agregó durante la semana.

Es el módulo con más gente afectada y por eso va último.

### 4. La pestaña `OT` es un derrame, no datos

Las columnas A a J de `OT` son **un solo `QUERY(IMPORTRANGE())` que derrama**
desde la hoja de respuestas del formulario: en 399 filas hay 1 fórmula y 0
literales. El sistema no puede escribir ahí sin romper el derrame o ser pisado
por él.

Para ese módulo, la bajada exige **sacar el derrame y poner literales**, que es
una restructuración real de la planilla y no sólo un cambio de permisos. Es la
segunda razón por la que Mantenimiento va último.

## El orden, y por qué

De menos a más gente afectada:

| # | Módulo | Por qué ahí | Lo que hay que hacer afuera |
|---|---|---|---|
| 1 | **Calidad / Envases** | 1.506 filas, kardex simple, un solo sector carga, sin formulario. El sistema ya escribe ahí | Proteger la pestaña, sumar la cuenta de servicio |
| 2 | **Calidad / Carbonilla** | Mismo kardex y mismo sector que el anterior, así que el cambio de costumbre es uno solo | Ídem |
| 3 | **Inventario** | 4.584 filas, el mismo patrón de kardex, pero es el almacén y lo mira más gente | Ídem |
| 4 | **Compras** | Hay que apagar el formulario; 397 de 400 pedidos entran por ahí | Apagar el Form, avisar a los sectores |
| 5 | **Mantenimiento** | Apagar el formulario **y** desarmar el derrame de A–J | Lo anterior más restructurar `OT` |

**Carbonilla va segunda y no primera a propósito**, aunque sea la más chica: se
acaba de dar vuelta hace seis días y volver a tocarla sin que Envases haya
demostrado el patrón es pedirle al mismo sector que cambie dos veces en una
semana.

**Cada módulo se da por terminado cuando se mide que la carga efectivamente se
mudó** —filas nuevas con origen en el sistema, cero filas nuevas en la
planilla— y no cuando el código está desplegado. Es la lección del 13/10 y es lo
único que evita repetirla.

## Qué se construye

Una bajada por módulo, sobre `reemplazarPestana()` de
[lib/core/sheets.ts](../../../lib/core/sheets.ts), que ya existe: borra la
pestaña y la reescribe entera en un solo `PUT`. Es la misma pieza que usa el
[respaldo a Sheets](../../RESPALDO.md), que corre desde el 18/10 y es, de hecho,
el ensayo de esto mismo contra un libro propio.

El cron es semanal, los lunes, junto al respaldo.

## Lo que queda sin resolver

- **Si el dueño de cada planilla puede saltearse la protección.** Es lo único
  que queda de la trampa 1 y decide si alcanza con proteger o si además hay que
  bajar a esas personas a *Lector*.
- **El histórico.** La primera bajada reescribe la pestaña entera: hay que
  decidir si se conserva una copia del libro tal como estaba, y la respuesta
  casi seguro es sí, porque es irreversible.
- **`sheets_fila` deja de significar algo** una vez que el libro es generado.
  No hay que borrarla —es la prueba de qué fila vino de dónde durante la
  transición— pero deja de ser un ancla.
