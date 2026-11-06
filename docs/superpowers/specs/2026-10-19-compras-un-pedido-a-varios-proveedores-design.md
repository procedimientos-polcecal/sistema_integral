# Compras — un pedido se le puede comprar a varios proveedores

Diseño acordado el 19/10/2026.

## El problema, y cómo se descubrió

Salió de una frase al pasar. Mostrando el histórico de precios, la pantalla
decía *"costó $20.004.250 a BOLSAFLEX, BOLSERA, TORRACO, RECYCLE BAG"*, y lo
reporté como un nombre de proveedor sucio. No lo era: **se usaron cuatro
proveedores para un mismo pedido**, y como el sistema no sabe expresar eso,
alguien lo escribió en el nombre.

`compras_requerimientos.proveedor_id` es una sola clave foránea. Un RI tiene un
proveedor y punto. Cuando la compra se reparte, la única salida que le queda a
la persona es **crear un proveedor nuevo que se llame como la lista**.

## Lo que se midió

| | |
|---|---|
| Proveedores que en realidad son una lista | **19** de 396, todos **sin CUIT** |
| RI comprados a una lista | **21**, por **$176.390.406** |
| De esos, de monto alto | **16** — o sea más del 10% de los 152 RI caros |
| Que llegaron a tener una orden en Odoo | **0** |
| Que tienen número de OC | **0** |

El catálogo crece con cada combinación, y **el orden en que se escriben crea
duplicados**: `TORRACO, BOLSAGRO` y `BOLSAGRO, TORRACO` son dos registros
distintos para el mismo par. Hay cinco variantes de combinaciones de bolsones.

La plata que hoy no se le atribuye a nadie, repartida en partes iguales sólo
para dimensionar —**no para guardarla así**—:

```
TORRACO      $57.976.672        BOLSERA       $12.326.196
BOLSAFLEX    $39.049.570        RECYCLE BAGS  $11.915.978
RECYCLE BAG  $17.517.024        BRALBOL        $9.902.718
```

Si alguien pregunta cuánto se le compró a TORRACO este año, la respuesta está
$58 millones corta.

## Cuánto se puede recuperar solo, y cuánto no

Son **dos preguntas distintas** y tienen respuestas muy distintas:

**Quién participó: 16 de 21 resuelven solos.** Los nombres están escritos y son
exactos. No es "enlazar al que se le parece": es leer.

**Cuánto le tocó a cada uno: 2 de 21.** Con los presupuestos cargados, **cero**
—ninguno tiene cotizaciones de todos los proveedores de su lista; 7 tienen uno
solo y 14 ninguno—. Lo único que hay está en el libro SEGUIMIENTO DE COMPRA:

- **RI 472**: dos filas de verdad, TORRACO 180 y BRALBOL 1000.
- **RI 708**: una fila, pero alguien escribió `"BOLSAGRO (400), TORRACO (600)"`.

Y de esos 2 terminan entrando **3 cantidades y no 4**, porque el RI 472 es la
primera divergencia que el modelo nuevo destapa: **la planilla y el sistema no
dicen lo mismo**. La planilla anota TORRACO y BRALBOL; el sistema tiene ese RI
a nombre de `FLEXIRIGS, BRALBOL`. No se sabe cuál tiene razón, así que la fila
`(472, TORRACO)` **no se crea** —sería enlazar al que se le parece— y los 180
quedan sin cargar. Coincide BRALBOL 1000, y eso sí entra.

Ese RI 708 es la misma señal que las seis cotizaciones con `"30 y 45 dias CTA
CTE"` metido en el campo de condiciones: **la gente ya expresa lo que el sistema
no modela, en el único lugar que le queda**.

## El modelo

```
compras_requerimientos
  └─ proveedor_id            ← se queda; en el segundo tiempo pasa a reflejo
        │ 1..N
        ▼
compras_requerimiento_proveedores
  ├─ requerimiento_id
  ├─ proveedor_id
  ├─ monto      numeric NULL   ← cuánto le tocó. Null = no se sabe
  ├─ cantidad   numeric NULL
  └─ PK (requerimiento_id, proveedor_id)
```

Una fila por proveedor que participó, **siempre**, incluso cuando es uno solo:
si la tabla hija vale sólo para el caso raro, el caso raro es el que nadie
prueba.

### Qué pasa con `proveedor_id`, que es la decisión que define todo

Lo leen **75 archivos**. Migrarlos a todos es un cambio enorme; dejarlos leyendo
una columna que miente es peor.

La salida es que deje de ser un dato y pase a ser un **reflejo** mantenido por
un trigger sobre la tabla hija:

```
una sola fila hija   →  proveedor_id = ese proveedor
varias filas hijas   →  proveedor_id = NULL
```

Los 75 lectores siguen andando sin tocarlos y **nunca mienten**: muestran el
proveedor cuando hay uno y nada cuando son varios. Es el mismo patrón que ya usa
`monto_conocido`, y la misma regla de siempre — mejor null que un enlace
equivocado, porque un enlace equivocado no se nota nunca.

Las pantallas que quieran decir "4 proveedores" leen la tabla hija, y se migran
de a una.

### El monto queda en null, y no se reparte

En 19 de los 21. **No se divide en partes iguales**: un `$57.976.672` atribuido
a TORRACO que nadie verificó se lee igual que uno medido, y este repo ya tiene
escrito lo que pasa con los datos que se parecen a los buenos.

Lo que gana el modelo no es saber cuánto; es **saber que no lo sabe**, en vez de
contestar con un proveedor inventado.

## Resolver los nombres: la regla, y las dos excepciones

De los 18 nombres que viven dentro de las listas:

- **16 resuelven** contra el catálogo por nombre normalizado;
- **10 de esos tienen DOS candidatos**, porque el catálogo tiene duplicados:
  uno con `Mayúscula inicial` y CUIT —cargado por administración— y otro en
  MAYÚSCULAS sin CUIT, que es como escribe la importación de la planilla.
  **Gana el que tiene CUIT**: es el que Facturación y Odoo pueden cruzar.
- `RECYCLE BAG` **no existe**: es el singular de `Recycle Bags`
  (CUIT 30-71442874-4). Se mapea a mano, y queda escrito que es a mano.
- `BOLSERA` **no existe en ninguna forma**. Se crea, sin CUIT, porque no lo
  tenemos.

Las dos excepciones van nombradas en la migración y no en una heurística: dos
casos conocidos se resuelven mejor con dos líneas que con una regla difusa que
mañana enlace mal un tercero.

## Lo que esto destapa en Odoo

```sql
compras_odoo_ordenes  →  primary key (requerimiento_id, empresa_id)
```

Esa clave asume **una orden por requerimiento y empresa**, pero una orden de
compra de Odoo tiene **un** proveedor: un RI repartido entre cuatro necesita
cuatro órdenes, y hoy no entran.

Hay 9 órdenes en total y ninguna de los 21, así que **no hay nada roto
todavía**. El día que alguien mande a Odoo uno de estos pedidos, la clave lo
frena. La PK tendría que pasar a `(requerimiento_id, empresa_id, proveedor_id)`,
y eso **no va en esta migración**: es otro riesgo y otro módulo.

## Dos tiempos

**Primer tiempo — sólo sumar.** Crear la tabla hija y llenarla: 1.940 RI de un
proveedor dan una fila cada uno, los 21 de lista dan sus filas, se crea
`BOLSERA` y se mapea `RECYCLE BAG`. **`proveedor_id` no se toca.** Nada se rompe,
nada cambia en pantalla, y a partir de ahí el dato correcto existe.

**Segundo tiempo — invertir el dueño.** Pasar `proveedor_id` a trigger,
desactivar los 19 proveedores-lista, y mostrar "varios proveedores" donde
corresponda. Es el paso que se nota, y conviene darlo cuando el primero lleve
unos días sin sorpresas.

## Riesgos asumidos

- **No se sabe si los 21 están completos.** Se midieron los proveedores con coma
  en el nombre. Puede haber pedidos repartidos cargados con un solo proveedor
  —el principal— y de ésos no queda rastro. **Es el piso, no el total.**
- **El `monto` null va a quedar null mucho tiempo.** Nadie va a volver sobre 19
  pedidos de 2025 y 2026 a reconstruir cuánto le tocó a cada uno.
- **El catálogo de proveedores tiene 71 nombres duplicados en 150 filas**, con el
  mismo patrón de mayúsculas y CUIT. Sólo 12 RI apuntan a la copia mala, por
  $8,8M, así que es basura de catálogo y no corrupción: **queda para otra tarea**,
  y acá sólo se lo esquiva con la regla de preferir el que tiene CUIT.
- **Y hay duplicados que esa regla no toca, porque no son el mismo nombre.**
  De los 17 proveedores destino, 6 quedaron sin CUIT, y al menos uno tiene par:
  `TORRACO` contra `Torraco Pablo Javier` (CUIT 23-21481183-9). No se unieron
  **a propósito** —son nombres distintos y unirlos es adivinar—, pero quiere
  decir que preguntar "cuánto se le compró a Torraco" sigue necesitando la
  limpieza de catálogo. Lo mismo por el otro lado: `Recycle Bags` y
  `Envases Reciclados [Recycle Bag]` son dos registros **con el mismo CUIT
  30-71442874-4**, o sea la misma empresa dos veces.
