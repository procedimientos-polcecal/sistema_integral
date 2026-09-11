# Migraciones

Se corren **a mano, en orden, en el editor SQL de Supabase**. No hay CLI ni
tabla de control: el nombre del archivo es lo único que dice qué va antes.

## El nombre lleva marca de tiempo

```
20260902114530_inventario_sheets_fila_unica.sql
└──────┬─────┘ └───────────┬──────────────┘
  cuándo se escribió      qué hace
  YYYYMMDDHHMMSS
```

Antes se numeraban `001`, `002`, `003`. Se cambió el 2 de septiembre de 2026
porque **dos sesiones trabajando en paralelo toman el mismo "próximo número
libre" y chocan**. Pasó tres veces el mismo día: quedaron dos `044`, dos `045` y
dos `048`, y con las dos `048` una se corrió y la otra no, así que la
sincronización del almacén falló por una columna que faltaba. La marca de tiempo
no puede repetirse entre sesiones.

Para crear una:

```bash
npm run migracion "inventario sheets fila unica"
```

Imprime el archivo con su encabezado y la ruta. El timestamp no se escribe a
mano: catorce dígitos son fáciles de errar y un dígito de menos rompe el orden.

## Las que ya estaban numeradas se quedan así

De la `001` a la `049` conservan su número. **No se renombran**, y no es
pereza: hay 38 referencias en 24 archivos que las citan por número —"la 032
decidió que los contratistas son proveedores", "la 019 dejó el enlace en
null"—, en comentarios de otras migraciones, en los specs y en los documentos de
estado. Esas referencias son la memoria de por qué la base es como es.
Renombrar los archivos las invalidaría todas para resolver un problema que sólo
existe en los archivos nuevos.

El orden entre los dos formatos funciona solo: alfabéticamente `0…` va antes que
`2…`, así que el bloque numerado corre primero y las nuevas después.

## Antes de escribir una migración

Nueve trampas que esta base ya pisó, dos de ellas **dos veces**:

**Un valor de enum nuevo viaja solo.** Postgres no deja usar un valor de enum
hasta que la transacción que lo agregó commiteó, y el editor de Supabase corre
cada script dentro de una transacción. Si el `alter type` comparte archivo con
algo que mencione ese valor —incluso el cuerpo de una función, que se valida al
crearla— falla con `55P04`. Por eso la `015` y la `045` tienen una sola
sentencia. Ver `015_nucleo_compras_enum.sql`.

**Un índice parcial no sirve como destino de `ON CONFLICT`.** `create unique
index … where columna is not null` parece más prolijo, y hace fallar todo
`upsert` que apunte a esa columna con "there is no unique or exclusion
constraint matching the ON CONFLICT specification". Un índice único común hace
lo mismo sin el problema: en Postgres los nulos no chocan entre sí. Pasó en la
`033` con `sectores.codigo` y **otra vez** en la `046` con
`inventario_movimientos.sheets_fila`. Ver `034` y `049`.

**Los catálogos del núcleo los comparten cinco módulos.** `sectores`, `equipos`,
`empleados`, `proveedores` y `usuarios` no son de nadie en particular. Una
migración de un módulo no los borra ni los rehace: los lee. Ver
`032_mantenimiento_proveedores.sql`.

**Un error en cualquier línea revierte el archivo entero.** El editor de
Supabase corre cada script dentro de una transacción, así que una migración que
falla en la línea 130 no deja ni las tablas que creó en la 40. Desde afuera se
ve **exactamente igual que si nunca se hubiera ejecutado** — la app dice "no
existe la tabla" y uno busca el problema en el lugar equivocado. Dos
consecuencias prácticas: escribir las migraciones para poder correrlas de nuevo
(`if not exists` en todo, y `drop trigger if exists` antes de `create trigger`,
que no acepta `if not exists`), y leer el mensaje rojo del editor antes de dar
por hecho que corrió. Pasó con la `20260903090920`: `min(id)` sobre una columna
uuid, y **Postgres no tiene `min()` para uuid** —el tipo sabe ordenarse pero no
hay agregado definido—, así que las dos tablas y los 85 registros del sembrado
se revirtieron sin dejar rastro. Para elegir un valor de un grupo de uno,
`(array_agg(id))[1]`.

**Una tabla puente rompe embeds que andaban.** Una tabla con exactamente dos
claves foráneas —el caso normal de una relación de muchos a muchos— hace que
PostgREST vea un segundo camino entre esas dos tablas, y a partir de ahí todo
`select` que las embeba sin aclarar cuál falla con `PGRST201`. La migración se
aplica sin un error y lo que se rompe es una pantalla que nadie tocó, en otro
módulo, minutos después. Pasó con la `20260904084145`: `compras_odoo_ordenes`
enlaza un requerimiento con una empresa, y el listado de requerimientos —que
venía trayendo `empresas(nombre)` desde la `017`— dejó de cargar entero. Se
arregla del lado del `select`, nombrando por dónde ir:
`empresas!empresa_id(nombre)`. Al agregar una tabla puente, buscar los embeds
de las dos puntas antes de darla por terminada.

**Enlazar al que se le parece es peor que dejar en null.** Cuando una planilla
nombra algo en texto libre y no se lo puede reconocer con certeza, el enlace
queda vacío y se informa. Un enlace equivocado no se nota nunca: el dato
simplemente aparece en el lugar que no es. Ver
`032_mantenimiento_proveedores.sql` y `042_compras_ubicaciones_a_equipos.sql`.

**Una migración aplicada no se edita: se corrige con otra.** No hay tabla de
control, así que nada avisa si un archivo ya corrió — y editarlo deja el archivo
y la base diciendo cosas distintas, sin señal hasta que algo falla lejos. Pasó
con `20260908104729_despacho_schema.sql`: se la editó para que `empresa_id`
fuera nullable creyendo que todavía no se había aplicado, y el síntoma apareció
un día después al importar el histórico, con un `null value in column
"empresa_id" violates not-null constraint` **contra un archivo que decía
nullable**. Peor que el rato perdido: una base armada de cero desde los archivos
no habría quedado igual que producción. El arreglo fue devolverle a la
`20260908104729` lo que realmente creó y relajar la columna en
`20260909095546`. Si hay dudas de si corrió, mirar la base (el esquema que
publica PostgREST en `/rest/v1/` dice qué columnas son `required`), no el
archivo.

**Una función en un índice necesita el cast explícito.** `date_trunc('month',
fecha)` sobre una columna `date` falla con `42P17: functions in index expression
must be marked IMMUTABLE`, y el motivo no está a la vista: `date` tiene cast
implícito **a los dos**, `timestamp` y `timestamptz`, y ante el empate Postgres
elige el tipo preferido de la categoría, que es `timestamptz`. Esa variante de
`date_trunc` es `STABLE` —depende del `TimeZone` de la sesión—, y un índice no
puede depender de eso: la misma fila daría claves distintas según quién
consulte. El arreglo es elegir la variante buena a mano: `fecha::timestamp`.
Vale igual para `to_char` y `extract`, que tienen el mismo par de sobrecargas.
Pasó en `20260909090003_despacho_la_planilla_es_una_pestana_por_mes.sql`.

**Agregarle una columna a una tabla y crear otra que la referencia, en ese
orden, da `40P01: deadlock detected`.** Y el mensaje no dice nada útil: habla de
dos procesos y de números de relación.

Crear una tabla con `references otra_tabla` toma sobre la referida un
`ShareRowExclusiveLock`; un `alter table otra_tabla add column` necesita un
`AccessExclusiveLock`. Hacer el `create` primero y el `alter` después es una
**subida de lock** dentro de la misma transacción, y entre las dos queda una
ventana. Supabase dispara la relectura del esquema de PostgREST con cada DDL, así
que justo ahí entra PostgREST, toma `AccessShare` sobre la tabla referida —lo que
bloquea el `alter`— y después pide leer la tabla recién creada, que la migración
todavía tiene tomada. Cada uno espera al otro.

El arreglo es de una línea: **los `alter table` primero, los `create table` que
la referencian después.** Así la transacción ya tiene el lock más fuerte cuando
crea la tabla y no hay subida. Pasó en
`20260911103029_facturacion_el_detalle_de_la_factura.sql`.

## Y una que no es de las migraciones pero muerde igual

`PostgREST corta en 1000 filas y no avisa`: `.limit(3000)` devuelve 1000. Al
escribir código que lea una tabla que puede crecer, usar `traerTodo()` de
`lib/core/paginado.ts`. Y un `.in()` con muchos ids arma una URL que PostgREST
rechaza con un 400 sin decir por qué: filtrar por una condición, o de a lotes.
