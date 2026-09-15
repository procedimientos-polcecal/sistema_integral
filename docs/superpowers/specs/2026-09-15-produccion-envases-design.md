# Envases — el stock de envases, dentro de Producción

Diseñado el 15 de septiembre de 2026.

Calidad —el sector que ya carga el parte de fábrica— lleva además una planilla
de **stock de envases**: bolsas, bolsones y mallas. Esto la espeja, con la misma
mecánica que Inventario y en un solo lugar donde antes había una pestaña que
sólo mira quien la tiene abierta.

La planilla es
`1NDVbtfG8zbC7AaJ-_tr1VUrKOsg23Lsr8-NeoNBvJAI`, y la cuenta de servicio del SdG
ya está invitada como lectora.

---

## Lo que la planilla es, medido y no supuesto

Es **la planilla del almacén clonada**: mismos nombres de pestaña
(`Listado articulos GRAL`, `Entradas  Salidas` —con doble espacio—, `CONSULTA`)
y la misma mecánica de fondo, que es la razón por la que "tiene la misma lógica
que Inventario" es cierto al pie de la letra:

> El stock del listado es una **fórmula** sobre el kardex:
> `inicial + Σ entradas − Σ salidas`.
> Por eso es el stock consolidado correcto, y por eso el SdG lo **lee** en vez
> de calcularlo.

Pero las columnas del kardex **no** son las del almacén:

| | almacén (`GESTIÓN DE ALMACÉN`) | envases (esta) |
|---|---|---|
| A | N° RI | **CODIGO** |
| B | código | descripción — *fórmula `VLOOKUP`* |
| C, D | descripción, entrada | **ENTRADAS, SALIDAS** |
| E, F | salida, solicitante | **ROTURA, DESPACHO** ← no existen allá |
| G | saldo — *fórmula* | saldo — *fórmula* |
| H, I, J | fecha, proveedor, sector | fecha, **OBSERVACIÓN**, proveedor |
| K | equipo | **grupo de envase** — *`ARRAYFORMULA` sin encabezado* |

Escala al 15/09/2026: **26 artículos**, **1.398 movimientos** entre el
01/09/2025 y el 12/09/2026, 16 proveedores y 5 colores de referencia.

### Las tres cosas que se midieron antes de diseñar

**1. `ROTURA` y `DESPACHO` no mueven el stock, y no se derivan de `SALIDAS`.**
La fórmula del listado sólo usa C y D. Y no es que la rotura esté "adentro" de
la salida: en **950 de 1.309** filas de salida `SALIDAS ≠ DESPACHO + ROTURA`, y
en **133** hay despacho con salida en cero. Son tres números independientes que
la planilla anota juntos.

**2. El informe por período de la planilla cuenta de más.**
`Entradas  Salidas x Envase` calcula sus ingresos y egresos con comodines sobre
la **descripción** (`"*2,10*"`, `"*1,20*"`, `"*NUEVOS*"`), y
`BOLSONES NUEVOS TORRACO (1,20 P 02)` matchea `"*1,20*"` **y** `"*NUEVOS*"`: cae
en dos grupos. Su columna `STOCK FINAL`, en cambio, agrupa por la **K**, que
agrupa bien. O sea que las dos mitades de la misma tabla no se calculan igual.

**3. Las fórmulas del kardex llegan hasta la fila 3296.**
B y G están arrastradas hasta ahí (verificado celda por celda), así que una fila
escrita al final se autocompleta sola y hay ~1.890 libres antes de tener que
estirar nada. La K es una `ARRAYFORMULA` desde `K2`, que cubre la columna
entera.

---

## Dónde vive

**Sección de Producción, no módulo nuevo.**

- `app/(app)/produccion/envases/` — las pantallas
- `lib/produccion/envases/` — lo puro: parser, agrupador, espejo
- `app/api/produccion/envases/` — las rutas

Usa las tres funciones de permiso que Producción ya tiene
(`tiene_acceso_produccion`, `puede_editar_produccion`, `es_admin_produccion`).
**No hay valor de enum nuevo**, así que no hay migración suelta ni riesgo de
`55P04`, y no hay que darle un módulo nuevo a nadie a mano: quien ya entra a
cargar el parte del turno entra a esto.

En el sidebar es un sub-grupo de Producción — `NavItem.children` ya anida dos
niveles y el `Sidebar` ya lleva `abiertoSub`.

---

## El modelo, y el único punto donde no se copia a Inventario

> **Un movimiento no es `tipo` + `cantidad`. Es una fila con cuatro números.**

Inventario parte cada renglón en entrada *o* salida *o* ajuste. Acá eso no se
puede: hay **4 filas con entrada y salida a la vez**, y la rotura y el despacho
conviven con la salida en la misma fila. Partirlas daría varios movimientos por
una sola fila de planilla, y eso rompe el `sheets_fila` único — que es
justamente lo que hace que volver a importar no duplique.

```sql
produccion_envases_articulos            -- 26 filas
  codigo text unique, descripcion, ubicacion, proveedores_ref,
  grupo text,                           -- lo que dice la K; null si no se reconoce
  stock_inicial numeric,
  stock_actual  numeric,                -- LO QUE DIJO la F, no un cálculo del SdG
  stock_seguridad numeric,
  faltante numeric generated always as
           (greatest(stock_seguridad - stock_actual, 0)) stored,
  stock_sincronizado_en timestamptz,
  sheets_fila int, activo boolean

produccion_envases_movimientos          -- 1.398 filas
  articulo_id, codigo,
  fecha date,                           -- date y no timestamptz: es un día
  entrada numeric default 0,
  salida  numeric default 0,
  rotura  numeric default 0,
  despacho numeric default 0,
  observacion text,
  proveedor_raw text, proveedor_id uuid references proveedores(id),
  origen text ('app'|'planilla'), creado_por,
  sheets_fila int unique where not null,
  sheets_pendiente text, sheets_pendiente_en timestamptz,
  check (entrada + salida + rotura + despacho > 0)

produccion_envases_proveedores          -- 16 filas
  nombre unique, tipos, contacto_nombre, contacto_tel, contacto_alt,
  direccion, notas, cuit, proveedor_id uuid references proveedores(id), sheets_fila

produccion_envases_referencias          -- 5 colores
  color unique, proveedor_nombre, proveedor_envases_id, orden, sheets_fila

produccion_envases_referencias_historial -- 3 líneas hoy
  texto, sheets_fila
```

El `check` y el `date` no son invención: son dos lecciones que Inventario ya
pagó (`20260903081542_inventario_la_fecha_del_kardex_es_un_dia_no_un_instante`).
Ninguna de las 1.398 filas tiene los cuatro números en cero, así que el `check`
no rechaza nada de lo que hay.

`stock_actual` es **lo que dijo la planilla la última vez que se la leyó**, con
`stock_sincronizado_en` al lado. Un número sin fecha se lee como si fuera de
ahora.

### Por qué el historial de `REFERENCIAS` se espeja

La tabla de colores **sin su historial miente**. Hoy dice "AMARILLO = RECYCLE
BAG", y es verdad; entre el 9 y el 10 de junio de 2026 no lo era, y desde el
3 de julio el verde es de Bolsera y no de Recuperadora del Sur. Guardar sólo la
foto de hoy hace que un bolsón viejo se le atribuya al proveedor equivocado,
que es la forma de error que este repo evita en todos lados: el dato aparece en
el lugar que no es y no se nota nunca.

---

## El espejo — acá manda la planilla

Producción es la excepción del sistema (allá manda el SdG y la planilla es una
exportación de una vía). **Esta sección no sigue esa excepción**: su planilla es
de forma Inventario y se comporta como Inventario. Conviene tenerlo presente al
retomar el módulo, porque las dos direcciones conviven en el mismo lugar.

### Leer — `lib/produccion/envases/sincronizar.ts`

Las cuatro pestañas, **por encabezado con alias y nunca por posición**: una
columna insertada a mano corre todo lo que está a su derecha y nadie se entera.

- `fechaDeSheets()` para el d/m — leerlo al revés dio vuelta 885 fechas en
  Compras.
- `traerTodo()` de `lib/core/paginado.ts`: 1.398 filas ya pasan el corte mudo de
  1000 de PostgREST.
- `registrarSincronizacion()`, como los otros módulos.
- **La primera corrida es la carga inicial.** No hay importador aparte: un
  script `.mjs` no podría usar este parser y habría que duplicarlo sin tests,
  que es cómo las dos copias se separan.

El `grupo` del artículo sale de la **K del kardex**, que es la que la planilla
usa para agrupar bien. Un código sin movimientos no tiene K, y un código cuyas
filas digan dos grupos distintos es una divergencia: en los dos casos el grupo
queda en **null** y se informa en el resultado de la sincronización. Enlazarlo
al que se le parece es peor que dejarlo vacío.

### Escribir — `lib/produccion/envases/espejo.ts`

Columnas escribibles: **A, C, D, E, F, H, I, J**.

**Nunca B, G ni K.** B es un `VLOOKUP`, G es el saldo corriente y K es la
`ARRAYFORMULA`: escribir cualquiera de las tres la rompe, y con G se rompe el
stock de todo lo que viene abajo.

La fila libre se **busca** con `filaSiguienteSegunLaColumna` sobre la A, no se
cuenta: la última fila con código es la 1403 pero sólo 1.398 tienen datos — hay
huecos en el medio.

El espejo **no corre en segundo plano**, por la misma razón que en Inventario:
un movimiento que no llega a la planilla **no existe**, porque la próxima
sincronización lee el stock de la fórmula —que no lo incluye— y revierte el
número. Si falla, queda `sheets_pendiente` con **lo que dijo Google sin
traducir**, y se le dice a quien hizo la acción. Un diagnóstico que no se
distingue de otro no es un diagnóstico.

Requiere que la planilla esté compartida como **editor** con la cuenta de
servicio; hoy está como lectora.

---

## Las pantallas

| Ruta | Qué muestra |
|---|---|
| `/produccion/envases` | El stock de los 26, ordenado por faltante contra el stock de seguridad. Botón "Traer de la planilla" |
| `/produccion/envases/movimientos` | El kardex filtrable por artículo, grupo y fechas. Y el alta de un movimiento |
| `/produccion/envases/periodo` | Ingresos, egresos y stock por grupo entre dos fechas |
| `/produccion/envases/proveedores` | Los 16 proveedores, la tabla color→proveedor y su historial |

### `/periodo` va a dar distinto a la planilla, y es a propósito

Agrupa por el `grupo` del artículo —la K—, no por comodines sobre la
descripción. Los bolsones nuevos, que la planilla cuenta en dos grupos, acá
cuentan en uno. La diferencia va explicada en la pantalla para que no se lea
como un bug del SdG.

El `STOCK FINAL` de la planilla tiene además otro agujero que no se replica:
sólo suma los artículos que tienen **al menos un movimiento**, así que un
artículo con stock y sin movimientos no aparece en el total de su grupo.

Acá el mismo artículo tampoco tiene grupo —la K sale del kardex, y sin
movimientos no hay K—, así que el riesgo existe igual. La diferencia es que
**no desaparece**: `/periodo` lleva una fila **"Sin grupo"** al final con esos
artículos y su stock. Un total que no cierra se ve; uno al que le falta un
renglón, no.

---

## Qué se testea

Vitest sobre funciones puras, que es donde están las decisiones:

- el parser de las cuatro pestañas, incluida la fecha d/m
- `agruparPorEnvase`, con `BOLSONES NUEVOS TORRACO (1,20 P 02)` como caso: cae
  en **un** grupo, no en dos
- `filaDeMovimiento`: que no arme jamás las columnas B, G ni K
- el reconocimiento de proveedores por CUIT y por nombre — lo ambiguo queda en
  `null` y se informa

---

## Variables de entorno

| | |
|---|---|
| `GOOGLE_SHEETS_ENVASES_ID` | `1NDVbtfG8zbC7AaJ-_tr1VUrKOsg23Lsr8-NeoNBvJAI` |
| `GOOGLE_SHEETS_ENVASES_TAB` | `Listado articulos GRAL` |
| `GOOGLE_SHEETS_ENVASES_TAB_MOV` | `Entradas  Salidas` — **con doble espacio** |
| `GOOGLE_SHEETS_ENVASES_TAB_PROV` | `PROVEEDORES` |
| `GOOGLE_SHEETS_ENVASES_TAB_REF` | `REFERENCIAS` |

Van a `docs/VARIABLES-VERCEL.md` cuando se implemente.

---

## Riesgos asumidos

- **La rotura no descuenta stock.** Se guarda y no se descuenta, igual que la
  planilla. Si mañana se decide que sí, es una consulta y no una migración: los
  cuatro números están guardados crudos.
- **La J (proveedor) está vacía en las 1.398 filas.** Se espeja igual, porque el
  alta desde la app la puede llenar.
- **`CONSULTA` no se espeja.** Es basura heredada del almacén: columnas "QUIEN
  LO PIDIÓ / N°RI / SECTOR" que en envases no existen, y seis filas residuales
  del 31/07/2025 sin código.
- **Las migraciones las corre una persona.** Nada de esto funciona hasta que el
  usuario aplique el DDL a mano en el editor SQL de Supabase.
