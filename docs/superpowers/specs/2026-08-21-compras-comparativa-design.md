# Compras — La comparativa de proveedores — Design Spec

**Fecha:** 2026-08-21
**Estado:** Implementado y en producción

## Objetivo

Que la comparativa de presupuestos se cargue y se resuelva **dentro de la app**,
sin abrir Google Sheets, y que las planillas de Drive queden como base de
información y respaldo. Hoy la comparativa es un campo de texto con un link y
una tabla (`compras_cotizaciones`) que nunca tuvo pantalla.

## Punto de partida

En el circuito real, entre que gerencia aprueba un pedido y que Compras lo pide,
hay un tramo que el sistema no acompaña:

```
APROBADA → [EN_COMPARATIVA] → PARA_COMPRAR (NICO|MAXI) → APROBADO → PEDIDO
              ↑ acá no hay nada
```

Lo que existe:

- `compras_requerimientos.comparativa_url`: un texto que se sincroniza a la
  columna `COMPARATIVA PROVEEDORES` de las hojas por área.
- `compras_cotizaciones`: tabla bien modelada pero sin pantalla, y por lo tanto
  vacía. Sólo se muestra en modo lectura en la ficha del RI.
- El código ya exige `comparativa_url` + `compra_asignada_a` para pasar a
  `PARA_COMPRAR`, y ya restringe `APROBADO` a la persona asignada.

Fuera del sistema: una carpeta de Drive con **una planilla por comparativa**,
todas con la forma de `00. COMPARATIVA DE PROVEEDORES GENERICO.xlsx`.

## La plantilla, tal como es

19 columnas. La comparativa real es bastante más rica que la tabla que había en
la base:

| Col | Encabezado | Qué es |
|---|---|---|
| A | `NRO RI` | **el vínculo con el pedido** |
| B-D | `FECHA`, `ÁREA`, `DESCRIPCION` | datos del RI, repetidos por fila |
| E-G | `PROVEEDOR`, `MARCA`, `UNIDAD DE MEDIDA` | |
| H-I | `PRECIO UNITARIO`, `CANTIDAD` | |
| J | `ENVÍO` | |
| K-L | `DESCUENTO`, `IVA` | porcentaje **por fila** |
| M | `PRECIO TOTAL` | `=H*I*(1-K)*(1+L)` |
| N | `PRECIO HASTA` | fecha: hasta cuándo vale ese precio |
| O | `PLAZOS` | días de pago: 0, 15, 21, 30, 45, 60, 90, 120, 150 |
| P | `CONDICIONES DE PAGO` | |
| Q | `DISPONIBILIDAD` | Inmediata, 1-3 días … 46-60 días |
| R | `COMENTARIO` | |
| S | `ELECCIÓN` | casilla; un formato condicional pinta la fila elegida |

Dos cosas que la base mezclaba: `plazo_entrega` confundía **plazo de pago**
(columna O, en días) con **disponibilidad** (columna Q, cuándo llega). Son datos
distintos y se separan.

## Decisiones

**La carga se hace en la app, y la planilla se sigue llenando.** Nadie abre
Drive para trabajar: cada presupuesto se carga en un formulario del sistema y se
escribe además como fila en la planilla elegida. Las planillas quedan como
respaldo y como histórico de precios por artículo, que es información que hoy
existe y conviene no perder.

**La columna A es el vínculo, no el nombre del archivo.** Los archivos tienen
nombres genéricos que a veces no corresponden a lo que pidió el RI, así que
ningún script puede mapearlos. Adentro, en cambio, cada fila lleva su `NRO RI`.
De ahí sale la regla que resuelve el caso del archivo genérico reutilizado: al
adjuntar una planilla se traen **las filas cuya columna A esté vacía o sea este
RI**, y las que tengan otro número se dejan quietas y se informan. Así una misma
planilla puede servir a varios pedidos a lo largo del tiempo sin pisarse.

**El total suma el envío, y lo calcula la base.** La fórmula de la plantilla deja
el envío afuera, y eso hace que dos presupuestos no sean comparables cuando uno
cobra el flete y el otro no. Confirmado con el usuario: es un error, no una
decisión. El total pasa a ser **columna generada** en Postgres:

```
precio_total = unitario × cantidad × (1 − descuento) × (1 + iva) + envío
```

Como columna generada, la cuenta vive en un solo lugar y no puede quedar
desfasada entre la pantalla, la API y el importador. El envío se carga tal como
lo cobra el proveedor: si lleva IVA, se carga con IVA incluido.

**El IVA sí lleva valor por defecto (21%).** Es la excepción a la regla del
módulo —prioridad y empresa nacen vacías porque un default es una decisión
disfrazada de dato—. Acá es distinto: el 21% es la alícuota general, un hecho, y
dejarlo vacío no significa "sin decidir", significa calcular un total **mal**.
Varía por proveedor, así que es editable por fila.

**Elegir es aprobar.** No es Compras quien elige el proveedor: Compras carga los
presupuestos y designa a quién le toca. NICO o MAXI eligen, y esa elección **es**
el acto de aprobar la compra. Un solo gesto, un solo botón.

**Cuántos presupuestos alcanza lo decide Compras.** No hay mínimo. Hay casos de
proveedor único y casos urgentes donde exigir tres frena el pedido sin motivo.
Lo único que se exige para pasar a "Para comprar" es que haya algo que mirar: un
presupuesto cargado o el link, porque si no la persona asignada no puede elegir.

**La comparativa se congela al aprobar la compra.** Desde ahí es el respaldo de
por qué se eligió ese precio. Antes de eso se puede editar, borrar y volver a
traer de Drive.

**Un proveedor puede cotizar dos veces el mismo pedido.** La plantilla tiene
columna `MARCA`, así que el mismo proveedor puede ofrecer dos marcas del mismo
artículo. El `unique (requerimiento_id, proveedor_id)` que hay hoy lo prohibiría:
se saca.

**Antes de escribir en una planilla ajena, se leen los encabezados.** El mapeo de
columnas se hace por nombre, no por posición, y si no coincide con la plantilla
genérica no se escribe y se avisa. Escribir a ciegas en un archivo con otra
estructura es la forma más fácil de arruinar la planilla de alguien.

## Modelo de datos

`compras_cotizaciones` se estira hasta la forma de la plantilla:

| Campo | Tipo | Nota |
|---|---|---|
| `marca` | text | |
| `unidad_medida` | text | |
| `cantidad` | numeric | |
| `descuento` | numeric(5,4) | fracción, como en la planilla |
| `iva` | numeric(5,4) | `not null default 0.21` |
| `precio_hasta` | date | hasta cuándo vale el precio |
| `plazo_pago_dias` | integer | |
| `disponibilidad` | text | reemplaza a `plazo_entrega` |
| `comentario` | text | |
| `condiciones_pago` | text | rename de `condiciones` |
| `precio_total` | numeric generado | la fórmula de arriba |
| `origen` | text | `app` o `drive` |
| `drive_fila` | integer | qué fila ocupa en la planilla |

`drive_fila` es lo que permite volver sobre esa fila sin duplicarla: cuando NICO o
MAXI eligen un presupuesto, se marca la casilla `ELECCIÓN` de esa misma fila en la
planilla, que es la que dispara el formato condicional que la pinta. Sin el número
de fila habría que adivinar cuál es.

Los renames son limpios porque la tabla no tiene datos reales (nunca hubo
pantalla) — se verifica contra la base antes de aplicar la migración.

En `compras_requerimientos`, qué planilla se adjuntó:

| Campo | Tipo |
|---|---|
| `comparativa_drive_id` | text |
| `comparativa_nombre` | text |

`comparativa_url` se mantiene: es lo que se sincroniza a la planilla del master y
lo que tienen cargado los RI históricos.

## Circuito

Los tres cambios sobre lo que ya existe:

| Paso | Hoy | Queda |
|---|---|---|
| → `PARA_COMPRAR` | exige `comparativa_url` | exige **un presupuesto cargado o el link** + `compra_asignada_a` |
| `PARA_COMPRAR` → `APROBADO` | sólo el asignado | igual, y si hay presupuestos hay que **elegir uno** |
| `APROBADO` → `PEDIDO` | se tipean proveedor y costos | se **bajan de la cotización elegida** |

**Bug en el camino, se corrige acá.** Al aprobar un RI, la ruta pone
`estado_compra` en `PARA_COMPRAR` directo, salteando `EN_COMPARATIVA`. Y como esa
asignación ocurre en la rama de aprobación del `if`, la validación de requisitos
—que vive en la rama de compra— no se ejecuta: el RI queda "para comprar" sin
comparativa ni asignado, que es justo lo que esa validación existe para evitar.
Debe quedar en `EN_COMPARATIVA`, que es lo que dicen el tablero y
`SIGUIENTE_ESTADO`.

## Flujo en pantalla

Todo en la ficha del RI, en un componente propio (`Comparativa.tsx`). La ficha ya
tiene 476 líneas: sumarle esto adentro la haría inmanejable.

1. **Elegir la planilla.** Con el RI en comparativa, un botón abre un selector con
   los archivos de la carpeta de Drive (nombre, última modificación, buscador). Al
   elegir uno se trae lo que ya tenga cargado según la regla de la columna A, y el
   archivo queda adjunto al pedido.
2. **Cargar presupuestos.** Un botón por presupuesto, con formulario: proveedor
   (del catálogo, con alta rápida), marca, unidad de medida, precio unitario,
   cantidad, envío, descuento, IVA, precio hasta, plazo de pago, condiciones,
   disponibilidad, comentario. El total se calcula a la vista mientras se escribe.
   Al guardar: fila en la base y fila en la planilla, con el N° de RI en la
   columna A.
3. **Volver a traer.** Borra las filas que vinieron de Drive y las relee —sobre
   esas manda la planilla— y deja intactas las que se cargaron en la app.
4. **Ver y elegir.** La persona asignada aprueba la compra con uno de los
   presupuestos.

### Cómo se muestra: dos momentos, dos formas

Resuelto después de mirar alternativas. Los mismos datos se muestran de dos
maneras, porque son dos trabajos distintos y el circuito ya los distingue:

| Momento | Quién | El trabajo es | La forma |
|---|---|---|---|
| `EN_COMPARATIVA` | Compras | administrar filas | una fila por proveedor |
| `PARA_COMPRAR` | el asignado | decidir | comparación atributo por atributo |

Mientras Compras arma la comparativa lo que hace es agregar, revisar y borrar:
para eso conviene la tabla compacta, que además aguanta cualquier cantidad de
presupuestos y deja la acción de borrar donde se la espera.

Cuando le toca decidir a NICO o MAXI, en cambio, hay que poder comparar atributo
por atributo. Es lo que hace visible el caso que motivó sumar el envío al total:
el proveedor con el unitario más bajo puede terminar siendo el total más alto
por el flete, y un IVA del 10,5% compensa un precio alto. En pantalla grande eso
es una **matriz** —la planilla dada vuelta, atributos en filas y un proveedor por
columna— con una fila de **diferencia contra el más barato**, que es el número
que más ayuda a decidir y el que nadie calcula a mano.

En el teléfono la matriz no sirve: obliga a un scroll horizontal que arruina
justamente la comparación. Ahí la misma vista pasa a **tarjetas apiladas**, una
por proveedor. Aprueban desde los dos lados, así que cambia por ancho de
pantalla, no por dispositivo.

No agrega estado: la bandera que elige la vista es la misma que ya decidía si
mostrar "Aprobar con este" o "Borrar".

**Los importes se muestran con centavos.** `moneda()` redondea a pesos, que
alcanza para un tablero pero no para una comparativa: dos presupuestos pueden
diferir por centavos y el redondeo lo esconde justo cuando alguien está
eligiendo. Para eso está `monedaExacta()`.

## Escribir en Drive

Se reusa el JWT a mano que ya tiene el módulo (`lib/compras/sheets.ts`, sin
`googleapis`), agregando el scope `drive.readonly` para listar la carpeta. Leer y
escribir cada archivo se hace con el scope `spreadsheets` que ya está.

Si Drive falla, el presupuesto **ya quedó guardado**: se avisa en pantalla y queda
pendiente para reintentar, exactamente el criterio que ya usa la sincronización
con el master (y el mecanismo de pendientes ya existe, migración 022).

Las filas nuevas llevan la fórmula del total **con el envío sumado**. Las viejas
conservan la original hasta que alguien las toque, así que por un tiempo una
misma planilla puede tener las dos fórmulas. Queda anotado como deuda: no se
reescriben filas ajenas en silencio.

## Importador de históricos

`scripts/import-compras/comparativas.mjs`, con las mañas del importador que ya
funciona: idempotente y con `--dry-run`. Recorre la carpeta, y en cada planilla
agrupa las filas por la columna A y las carga en el RI que corresponda. Saltea la
plantilla genérica. El dry-run reporta lo que no pudo resolver: N° de RI
inexistentes, proveedores nuevos, filas sin número y archivos que no son
planillas nativas de Google (esos habría que descargar y parsear aparte; el
dry-run dice cuántos hay antes de decidir si vale la pena).

El proveedor se resuelve por nombre con la misma tolerancia a nombres casi
iguales que ya usa `/compras/ubicaciones`.

## Tests

Con vitest, como el resto del módulo:

- La fórmula del total, incluido el envío y el descuento.
- Las reglas del circuito: no se puede pasar a `PARA_COMPRAR` sin nada que
  mirar; `APROBADO` exige elegir si hay presupuestos; `PEDIDO` baja proveedor y
  costos de la elegida.
- La regla de la columna A: se traen las filas vacías o propias, se ignoran las
  de otro RI.
- El mapeo por encabezados: una planilla con otra estructura no se escribe.
- Que aprobar un RI lo deje en `EN_COMPARATIVA` y no en `PARA_COMPRAR`.

## Pasos manuales

1. Compartir la carpeta de comparativas con la cuenta de servicio, **como
   editor** (ahora escribe, no sólo lee).
2. Cargar `GOOGLE_DRIVE_COMPARATIVAS_FOLDER_ID` en `.env.local` y en Vercel.
3. Correr el importador de históricos con `--dry-run` y revisar el reporte antes
   de correrlo de verdad.
