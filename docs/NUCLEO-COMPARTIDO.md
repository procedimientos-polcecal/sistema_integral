# El núcleo compartido: reglas que estaban escritas más de una vez

Escrito el 1 de septiembre de 2026, después de un barrido de bugs por todos los
módulos.

## Por qué existe este documento

Casi todos los bugs de datos que aparecieron en ese barrido tenían la misma
forma: **una regla implementada dos o tres veces, y mal en más de una copia.**
No eran errores distintos, era el mismo error copiado.

| La regla | Cuántas copias | Cuántas estaban mal |
|---|---|---|
| Qué separador decimal usa un número escrito a mano | 2 | 2 |
| La letra de una columna de Sheets a partir del índice | 3 | 2 |
| Qué día es hoy | 5 | 5 |

La de las fechas es la más ilustrativa. `lib/mantenimiento/alertas.ts` tenía un
`hoyISO()` escrito con getters locales **a propósito**, con el comentario "para
que el día no se corra en un servidor en UTC". Pero en Vercel la hora local es
la UTC, así que la versión "arreglada" devolvía exactamente lo mismo que la que
quería reemplazar. Alguien vio el problema, escribió una solución, y la solución
no hacía nada — porque no había un lugar donde la regla viviera una sola vez y se
pudiera probar.

## Qué hay ahora

Cada uno es un archivo chico, sin dependencias y con sus tests.

| Módulo | Qué decide | Lo usan |
|---|---|---|
| `lib/core/fechas.ts` | Qué día es hoy en Argentina, y aritmética de fechas `YYYY-MM-DD` | Remises, Mantenimiento, Compras |
| `lib/core/numeroArgentino.ts` | Si un punto es separador de miles o el decimal | Compras (comparativas), RRHH (import de empleados) |
| `lib/core/columnaDeSheets.ts` | La letra de una columna: 0 → A, 26 → AA | Compras, Mantenimiento |
| `lib/core/cuerpo.ts` | El cuerpo JSON de un request sin reventar si no hay | Las 58 rutas que lo parseaban a pelo |
| `lib/core/paginado.ts` | Traer más de 1000 filas, y qué página pidió el navegador | Todo |

### Por qué archivos separados y no uno de utilidades

Dos razones concretas, no gusto.

**Para no arrastrar dependencias.** `lib/core/sheets.ts` importa
`lib/core/google.ts`, que lee variables de entorno y firma un JWT.
`lib/compras/comparativa.ts` es a propósito un módulo sin red, que se prueba sin
credenciales. Si la letra de columna viviera en `core/sheets.ts`, importarla
metería toda esa cadena en un módulo puro y en sus tests.

**Para que el nombre del archivo diga de qué es la duda.** `columnaDeSheets.ts`
se encuentra buscando "columna". Un `utils.ts` de trescientas líneas no se
encuentra, y la cuarta copia se escribe igual.

## La regla, dicha

> Antes de escribir una función que decida algo —un formato, un separador, una
> letra, un día—, buscar si ya está. Si está en otro módulo, sacarla al núcleo
> con sus tests en el mismo commit.

El precedente estaba en el repo antes de esto, en `lib/compras/drive.ts`:

> *La regla de en qué fila escribir vive en el núcleo: la usan las cuatro
> planillas y tenerla dos veces es cómo se corrige en una sola.*

## Lo que sigue sin unificar, y por qué

**`lib/rrhh/dates.ts` no se toca.** Representa un día calendario como un `Date`
a medianoche UTC y lo lee con getters UTC, y el motor de liquidación depende de
esa forma de punta a punta. `lib/core/fechas.ts` trabaja con textos
`"YYYY-MM-DD"`, que es como viajan las fechas por la API y como Postgres guarda
una columna `date`. **Los dos son correctos y sirven para cosas distintas**: el
del núcleo para decidir qué día es hoy, el de RRHH para hacer cuentas con los
días de un período. Mezclarlos es el riesgo #12 del spec de la Fase 2.

**`lib/compras/sheets.ts` tiene su propio lector de planilla**, aparte de
`lib/core/sheets.ts`. Eso es deliberado: está atado a "PEDIDOS DE COMPRA" y trae
todo el manejo de celdas protegidas y de reintentos por 429 que esa
sincronización necesita. No es una copia, es otra cosa.
