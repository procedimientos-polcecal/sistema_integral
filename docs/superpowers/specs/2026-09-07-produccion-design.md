# Producción — el informe de fábrica deja de ser un papel

Diseño acordado el 7 de septiembre de 2026. Es el primer módulo del SdG que se
diseña **de cero**: no hay app de origen que portar. Lo que hay es un papel, una
persona que lo transcribe, y un Excel con un botón.

## De dónde sale esto

**El papel.** Formulario `040/2`, *INFORME DE FÁBRICA*, Polcecal S.A. – Polysan
S.A., Sierras Bayas. Uno por turno, firmado por el capataz. Tiene cinco partes:

| Sección del papel | Qué contiene |
|---|---|
| Cabecera | Día / mes / año, turno, **capataz de turno** con firma |
| Material en depósito | ~15 renglones agrupados en *Filler*, *0-2* y *Cal*, más un renglón libre "Otros" |
| Material despachado | **Una fila por camión**: equipo/cliente, producto y kilos, cantidad de bolsas/bolsones, tipo, cantidad y tipo de pallets, y roturas separadas en bolsa y bolsón |
| Observaciones | Texto libre con paradas y horarios: *"molino de 10:00 a 10:30, regulación y revisión"*, *"toro problema eléctrico"* |
| Tareas de limpieza · Recuento de bolsones | Texto libre por turno |

Hay **dos turnos**: 4→12 y 12→20. Las otras ocho horas no se registran.

**La transcripción.** `INFORME PRODUCCIÓN PT.xlsx`, seis hojas: `Carga Diaria`
(el formulario de entrada), `Histórico`, `Resumen Producción`,
`Resumen Despacho`, `Resumen Rotura`, y una hoja con el código de Apps Script
que el botón ▶ GUARDAR DÍA ejecuta. El encargado de calidad copia el papel a
`Carga Diaria` y aprieta el botón; el script vuelca los totales del día a los
tres resúmenes y el stock del turno 12→20 al `Histórico`.

**La producción no se anota en ningún lado: se despeja.** Ni el papel ni el
Excel tienen un número de "lo producido". Sale de la cuenta:

```
producción del turno = depósito − depósito anterior + despachado + rotura
```

## Lo que está roto hoy

**El stock inicial no está por fecha.** La fórmula de `Carga Diaria` resta la
columna `N`, oculta, que es **una sola por producto y no una por día**: el
script la pisa con el stock de hoy al guardar, para que "mañana esté puesta". Si
alguien cambia la fecha sin haber guardado el día anterior, guarda dos veces, o
abre un día viejo, la producción sale mal y nada avisa. En el archivo relevado
ya pasa: la fecha es 03/09 y `N` para *Bolsones de Cal* dice 2, pero el stock
del 02/09 en el `Histórico` es 20 — el "18 producido" de ese día sale de un
stock inicial que no es el del día anterior.

**Los meses de 31 días no entran.** `Histórico` va de la fila 3 a la 32 y los
resúmenes de la 5 a la 34: treinta días. El script busca la fila por fecha y, si
no la encuentra, aborta con un cartel.

**Los 17 productos están clavados** como filas en `Carga Diaria`, como columnas
en las otras cuatro hojas, y como rangos en el script. Agregar uno es tocar todo.

**Se tira la mitad del papel.** Del despacho sólo sobrevive un total por
producto: el cliente, los kilos, los pallets y qué camión se cargó desaparecen.
Las observaciones —que son paradas de máquina con horario, justo lo que
Mantenimiento no tiene— no sobreviven. Tampoco el capataz ni la limpieza.

**El mapeo papel → Excel no está escrito.** El papel tiene ~15 renglones en tres
familias y el Excel 17 columnas con otros nombres. La correspondencia vive en la
cabeza del encargado de calidad; si mañana lo hace otro, sale distinto.

**El % de rotura se esconde.** El script hace `rotura / producción` y devuelve 0
cuando la producción es 0. Un día sin producir con roturas muestra 0 %.

## Las decisiones

**Calidad sigue siendo quien carga.** El papel del turno no se toca y el capataz
no entra al sistema. Cambia el destino de la transcripción: el SdG en vez del
Excel. Es un módulo de una pantalla de carga y las consultas encima, sin
segundo rol ni estado de "turno cerrado".

**Sólo lo envasado.** Los productos en bolsa y en bolsón, contados en bultos. El
granel —que existe y se mide en toneladas— **no entra en este spec**: hoy no está
en este circuito y hay que relevar de dónde sale. El catálogo igual se modela
como tabla con presentación y unidad, así sumarlo después es cargar filas.

**La unidad de registro es el parte de turno**, uno por `(fecha, turno)`, que es
exactamente un papel. Los turnos se llaman `4_12` y `12_20`, con las horas
adentro del nombre: dice solo que faltan ocho horas, y el día que exista el
turno de noche es un valor más en el enum.

**La producción se despeja al leer y no se guarda.** El "depósito anterior" sale
del parte anterior en orden cronológico —el anterior a `4_12` es el `12_20` del
día previo; el anterior a `12_20` es el `4_12` del mismo día—, así que no puede
quedar viejo, porque no se almacena en ningún lado. Es la corrección directa del
agujero de la columna `N`.

**Si el parte anterior no existe, la producción no se calcula.** No sale cero ni
sale el número que había: sale *"no calculable, falta el parte del 02/09 turno
12→20"*, con el enlace para cargarlo. Es la regla del repo —mejor vacío que
parecido— aplicada a un número: un cero en una grilla de producción no se
distingue de un día sin producir. Por lo mismo, una producción **negativa** se
muestra en rojo con la cuenta desglosada y no se recorta a cero: es un error de
carga y hay que verlo.

**El despacho y la rotura no se tipean: se suman de los renglones.** Es una
cuenta que hoy se hace a mano sobre números que ya están escritos. La rotura
queda donde el papel la pone, en el renglón del camión, separada en bolsa y
bolsón.

**Acá manda el sistema, no la planilla.** Es la diferencia con Compras. Calidad
carga en el SdG y la planilla queda como el lugar donde miran los que no entran:
una exportación de una sola dirección. De eso se desprende que `Carga Diaria` y
el botón de Apps Script **desaparecen** —el SdG es la carga diaria— y que las
hojas que quedan conviene protegerlas. El riesgo asumido: si alguien igual
edita la planilla a mano, el SdG no se entera y la pisa la próxima vez que se
guarde ese día.

**Capataz y cliente se guardan como texto**, y además enlazados sólo cuando se
los reconoce con certeza. No hay catálogo de clientes en el núcleo: va a ser del
módulo Despacho, y hasta entonces el nombre es texto libre. Enlazar al que se le
parece es peor que dejar en `null`.

## Lo que se construye

### 1. El módulo en el núcleo — dos migraciones

La primera **viaja sola** y no hace nada más:

```sql
alter type modulo add value if not exists 'produccion';
```

Es la trampa del `55P04` del README de migraciones, que ya mordió dos veces:
cualquier cosa que mencione `'produccion'` en el mismo archivo falla porque el
valor nuevo del enum todavía no está confirmado.

La segunda trae las tablas, los índices, las tres funciones de permiso
(`tiene_acceso_produccion()`, `puede_editar_produccion()`,
`es_admin_produccion()`) y las policies de RLS, con el molde de la 046 de
Inventario. Las funciones de la base y `lib/produccion/auth.ts` tienen que decir
lo mismo: cuando no coincidieron, en la 029, un `admin_sistema` veía los botones
y RLS le devolvía listas vacías.

Los tres niveles: `lectura` mira, `edicion` carga y corrige partes, `admin`
además toca el catálogo de productos.

La carga del catálogo va aparte y **no es una migración**: es DML, así que la
puede aplicar un agente por PostgREST el día que calidad confirme la lista. No
se escribe antes: un catálogo inventado es exactamente el error que este módulo
tiene que no cometer.

### 2. Las tablas

```sql
create type produccion_turno   as enum ('4_12', '12_20');
create type produccion_familia as enum ('filler', '0_2', 'cal', 'otros');
create type produccion_envase  as enum ('bolsa', 'bolson');

create table produccion_productos (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null,
  familia         produccion_familia not null,
  envase          produccion_envase  not null,
  kg_por_unidad   numeric,          -- 25 la bolsa; el bolsón, a confirmar
  nombre_planilla text,             -- la columna del resumen; null = no se exporta
  orden           int not null,
  activo          boolean not null default true
);

create table produccion_partes (
  id                  uuid primary key default gen_random_uuid(),
  fecha               date not null,
  turno               produccion_turno not null,
  capataz_raw         text,
  capataz_id          uuid references empleados(id),
  observaciones       text,
  tareas_limpieza     text,
  recuento_bolsones   text,
  cargado_por         uuid not null references usuarios(id),
  cargado_en          timestamptz not null default now(),
  actualizado_por     uuid references usuarios(id),
  actualizado_en      timestamptz,
  sheets_pendiente    text,
  sheets_pendiente_en timestamptz,
  unique (fecha, turno)
);

create table produccion_deposito (
  parte_id    uuid not null references produccion_partes(id) on delete cascade,
  producto_id uuid not null references produccion_productos(id),
  cantidad    numeric not null,
  primary key (parte_id, producto_id)
);

create table produccion_despachos (
  id               uuid primary key default gen_random_uuid(),
  parte_id         uuid not null references produccion_partes(id) on delete cascade,
  orden            int not null,
  equipo_raw       text,
  cliente_raw      text,
  producto_id      uuid references produccion_productos(id),
  producto_raw     text,
  kilos            numeric,
  bultos           numeric,
  envase_raw       text,
  pallets_cantidad numeric,
  pallets_tipo     text,
  rotura_bolsa     numeric not null default 0,
  rotura_bolson    numeric not null default 0
);
```

`producto_id` de un despacho puede ser `null` con el texto crudo al lado: el
papel tiene un renglón "Otros" y nombres escritos a mano.

El `upsert` del parte va sobre `unique (fecha, turno)`, que es una constraint
completa y no un índice parcial — la otra trampa del README, que ya mordió dos
veces: **un índice parcial no sirve como destino de `ON CONFLICT`.**

El único índice parcial es el de los pendientes, que sí se consulta solo:

```sql
create index produccion_partes_pendiente_idx
  on produccion_partes (sheets_pendiente_en)
  where sheets_pendiente is not null;
```

### 3. La lógica pura — `lib/produccion/`

Todo lo que decide algo sale de la ruta. Es lo que hizo `repartirRegistroDeOT`
en Mantenimiento después de que un campo se colara del lado equivocado sin que
nada lo notara.

| Archivo | Qué decide |
|---|---|
| `turnos.ts` | Cuál es el parte anterior a `(fecha, turno)` |
| `produccion.ts` | El despeje, con `"sin_parte_anterior"` cuando falta el anterior, y los totales del día |
| `despachos.ts` | Sumar los renglones a totales por producto, separar rotura bolsa y bolsón, y comparar kilos con bultos × `kg_por_unidad` |
| `planilla.ts` | Armar las celdas de cada fila de resumen |
| `auth.ts` | Los niveles, espejando las funciones de la base |
| `espejo.ts` | La escritura a Google. Fino a propósito: arma celdas con `planilla.ts` y llama a `escribirCeldas` del núcleo |

`produccion.ts` **es el módulo**: es la fórmula que hoy vive en una celda de
Excel y en una columna oculta. Que esté en un archivo con tests es el objetivo
de todo esto.

La comprobación de kilos ↔ bultos **avisa, no bloquea**. El papel es el papel: si
los dos números no cierran se muestra la diferencia y se guarda igual.

**Reconocer el producto escrito a mano no lleva archivo nuevo.**
`lib/core/catalogo.ts` ya lo resuelve con `indiceDeCatalogo()` y `elQueNombra()`,
y ya trae la decisión que importa: un nombre que empata **no resuelve a
ninguno**, devuelve `null` diciendo si fue "no existe" o "ambiguo". Escribir un
`catalogo.ts` propio sería la cuarta copia de una regla que el núcleo tiene
justamente para que no haya cuartas copias.

Del núcleo se usan también `traerTodo()` de `lib/core/paginado.ts`,
`lib/core/fechas.ts` para qué día es hoy y para sumar días,
`lib/core/columnaDeSheets.ts` y `lib/core/cuerpo.ts`. Nada de esto se reescribe.

### 4. El espejo a la planilla

Al guardar un parte se escribe la fila del día en `Resumen Producción`,
`Resumen Despacho` y `Resumen Rotura`, con su % de rotura. Quien lee la planilla
no nota el cambio, salvo que los números aparecen solos.

**`Histórico` no se escribe.** Su propio encabezado dice "uso interno del
script, no editar": existe nada más para que el script sepa el stock del día
anterior. Como el SdG despeja la producción de sus propios partes, esa hoja no
tiene lector y muere junto con `Carga Diaria` y el botón.

Las reglas son las del repo, sin excepción:

- **La fila se busca por la fecha, no contando.** Si esa fecha no tiene fila
  —hoy, cualquier día 31— no se adivina: se anota el pendiente y se avisa.
- **Las fechas en d/m**, con el helper del núcleo. Leerlo al revés dio vuelta 885
  fechas en Compras.
- **Un fallo de escritura no es un `console.warn`.** Va a `sheets_pendiente` /
  `sheets_pendiente_en` **con lo que dijo Google sin traducir**, se le muestra a
  quien guardó, y se lista con un botón de reintentar. Igual que Compras e
  Inventario.

Las credenciales de Google no están en local: esto sólo se prueba en el deploy.

### 5. Las pantallas

| Ruta | Qué es |
|---|---|
| `/produccion` | El día: los dos partes, la producción despejada por producto, y arriba los avisos — falta el parte anterior, producción negativa, algo no llegó a la planilla |
| `/produccion/parte/[fecha]/[turno]` | La carga, en el orden del papel: cabecera y capataz · depósito agrupado en *Filler* / *0-2* / *Cal* · renglones de despacho · los tres textos |
| `/produccion/resumenes` | El mes por producto: producción, despacho, rotura y % rotura. Es lo que hoy son las tres hojas de resumen |
| `/produccion/productos` | El catálogo. Sólo `admin` |

Más la tarjeta del inicio, con el molde de la de Inventario: **partes sin cargar
de los últimos siete días** y **partes que no llegaron a la planilla**. Y el
módulo entra en `MODULOS_ORDEN` y `modulosVisibles` de `lib/core/access.ts`.

Dos partes por día con diez renglones cada uno son ~7.300 despachos al año.
**PostgREST corta en 1000 y no avisa**, así que todo lo que los barra usa
`traerTodo()` desde el primer día, y los filtros van por rango de fecha y nunca
por un `.in()` de muchos ids.

## Tests

Vitest sobre las funciones puras:

- **`turnos.ts`** — el cruce de día y de mes; el primer parte del histórico, que
  no tiene anterior.
- **`produccion.ts`** — la cuenta con los números del Excel relevado, que son
  legibles sin ambigüedad; el `"sin_parte_anterior"` cuando falta; el negativo,
  que se devuelve negativo.
- **`despachos.ts`** — los totales por producto; la rotura separada; el renglón
  con `producto_id` en `null`, que no se suma a ningún producto pero no se
  pierde; kilos que no cierran con bultos.
- **`planilla.ts`** — con un catálogo de juguete: el orden de las columnas, un
  producto con `nombre_planilla` en `null` que no se exporta, y el % de rotura
  con producción cero, que **muestra la rotura** en vez del 0 que muestra hoy.

`lib/core/catalogo.ts` ya tiene los suyos y no se duplican.

Las rutas y las pantallas no llevan tests, como en el resto del repo.

## Lo que hace falta de una persona

Nada de esto frena escribir el código ni los tests. Frena **cargar datos de
verdad**.

De calidad:

1. **El catálogo canónico, renglón por renglón.** El papel tiene ~15 renglones,
   el Excel 17 columnas con otros nombres, y la lista que dio el usuario 15
   productos distintos más el granel. Los tres conjuntos no coinciden y la
   correspondencia no está escrita. No se adivina: acá "enlazar al que se le
   parece" significa sumar la producción de un producto en la columna de otro, y
   eso no se nota nunca.
2. **Los kilos por unidad.** La bolsa son 25 kg; falta el bolsón, y si es igual
   para todos los productos.
3. **Qué va en cada columna de "Material despachado".** Hay dos —*Productos y
   kilos* y *Cantidad bolsa/bolsón*— y en los renglones relevados el número a
   veces parece kilos y a veces bultos (*Cal en bolsas — 1.200* junto a *Cal en
   bolsones — 29.000*). El relevamiento se hizo sobre una foto de letra
   manuscrita: hay que confirmarlo antes de transcribir.

Del usuario:

4. **El id de la planilla de Google**, compartida como **editor** con la cuenta
   de servicio del SdG, y la decisión de ampliarla a 31 filas.
5. **Correr las migraciones** en el editor SQL de Supabase. Son dos archivos, y
   el del enum va solo.

## Lo que este spec no incluye

- **El granel.** Es el volumen que no está medido en este circuito y necesita su
  propio relevamiento.
- **El módulo Despacho.** Los renglones de camión de acá son *lo que el capataz
  dice que cargó*, el registro de fábrica. El remito, el pesaje y el cliente como
  catálogo son de Despacho, que va a ser el dueño del papel comercial.
- **Las paradas de máquina como dato estructurado.** Por ahora las observaciones
  son texto libre, igual que en el papel. Convertirlas en paradas con equipo,
  motivo y horario —que es lo que Mantenimiento querría— es un spec aparte y
  necesita que alguien decida el vocabulario.
- **El histórico previo.** Este spec arranca en la fecha en que se empiece a
  cargar. Traer los meses viejos del Excel es una importación puntual y se
  decide después, cuando el catálogo esté cerrado.
- **Versionado de correcciones.** Se guarda quién cargó, quién modificó y
  cuándo. El historial completo de cada parte es más de lo que hace falta hoy y
  se puede agregar sin migrar nada de esto.
