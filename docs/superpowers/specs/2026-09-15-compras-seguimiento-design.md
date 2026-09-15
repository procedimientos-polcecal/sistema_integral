# Compras — seguimiento de la compra (fase 1: la recepción)

Diseño acordado el 15/09/2026. Reemplaza la carga a mano del libro
**SEGUIMIENTO DE COMPRA** (`1TS3JYzTF2M_XTlaqaACphSdSXc5K5rh6b6UsAXBSYx8`).

## El problema

Un RI que llega a `PEDIDO` se queda ahí para siempre: el SdG no tiene dónde
anotar que la mercadería llegó. Hoy **1.787 requerimientos están en `PEDIDO`** y
ninguno llegó nunca a `RECIBIDO`, porque la recepción vive en otra planilla que
se carga a mano.

Eso deja tres cosas afuera del sistema: si llegó, si llegó completo, y si llegó
cuando se dijo.

## Las cinco decisiones

1. **El SdG manda; la planilla sólo recibe.** Exportación de una dirección,
   como Producción. Quien no entra al sistema la sigue mirando.
2. **Un seguimiento por RI.** Sin recepciones múltiples: son 8 casos sobre 1.749
   (0,5%) y no justifican una tabla hija. Si una entrega llega en dos tandas se
   corrige la cantidad.
3. **`Cumplió COMPRAS?` y `Cumplió PROV?` se siguen eligiendo a mano**, con el
   dato duro al lado en la pantalla.
4. **Fase 1 = recepción.** La aplicación (`Se aplicó?`, `Fecha de Aplicación`,
   `Tiempo en Stock`) queda para una fase 2.
5. **Se importa el histórico**: las 1.757 filas que ya tiene la planilla.

## Lo que se midió antes de decidir

Todo esto salió de la planilla real y de la base, no de suponer.

| | |
|---|---|
| Filas reales en `COMPRAS CON RI` | 1.757, sobre 1.749 RI distintos |
| Filas cuyo `NºRI` existe en la base | **1.757 de 1.757.** Cero huérfanos: el cruce no tiene que adivinar |
| RI de la planilla que están en `PEDIDO` | 1.739 (99,4%). Los otros 10: 6 `SIN_INICIAR`, 3 `EN_COMPARATIVA`, 1 `PARA_COMPRAR` |
| `Cant Pedida` = cantidad del RI | 1.655 de 1.680 (99%). Las 25 restantes son reales: el RI 250 pidió 100 y se compraron 95 |
| Filas con fecha de recepción | 1.661 — ésas nacen `RECIBIDO` al importar |
| Áreas | Las nueve del `FILTER` coinciden **exactas** con las del SdG, `OTRA` en mayúsculas incluida |
| Locale del libro | `es_AR` / `America/Buenos_Aires`: `USER_ENTERED` lee d/m |
| Protecciones en `COMPRAS CON RI` | **ninguna** |
| Protecciones en las pestañas de área | una por hoja sobre `A:M`, y la cuenta de servicio **no** puede editarlas |

**`Cumplió` no es un cálculo**, y por eso se carga a mano: de los "Sí" de
`Cumplió COMPRAS?`, **295 llegaron tarde** (19%); de los "Sí" de `Cumplió PROV?`,
52 estaban incompletos, y 16 de los "No" habían recibido todo. Es un juicio
—llegó tarde pero avisó, llegó completo pero roto—, y calcularlo sería inventar
un dato que se le parece.

Después de importar, la bandeja de "esperando" arranca en **unos 144**: los 48
RI en `PEDIDO` que todavía no están en la planilla más los 96 que están sin
fecha de recepción. Ése es el número que hace usable la pantalla; 1.787 no sería
una bandeja sino un archivo.

## Forma del libro

```
COMPRAS CON RI        ← el master, cargado a mano hoy. 13 columnas, A:M
COMPRAS <ÁREA>  × 9   ← =FILTER('COMPRAS CON RI'!A2:M3151; C2:C3151="<Área>")
                         más sus columnas propias de la N en adelante
```

Las columnas de aplicación de cada área **viven al lado del `FILTER`** y son
posicionales. El `FILTER` respeta el orden del master.

## Modelo de datos

Siete columnas en `compras_requerimientos`. Se reusan `fecha_pedido` y
`fecha_recepcion`, que ya existen y están vacías: el esquema ya anticipaba esto.

```sql
cantidad_comprada        numeric   -- "Cant Pedida". Vacía = lo que pedía el RI
cantidad_recibida        numeric
fecha_estimada_recepcion date      -- "Fecha estimada"
cumplio_compras          text  check (in ('SI','MAS_O_MENOS','NO'))
cumplio_proveedor        text  check (in ('SI','MAS_O_MENOS','NO'))
seguimiento_fila         int       -- en qué fila del master quedó
seguimiento_pendiente    text      -- lo que la planilla rechazó, de este libro
```

**Texto con `CHECK` y no un enum**: los enums de este repo ya mordieron dos veces
(`55P04`), y estos tres valores son de la planilla, no del dominio.

**`seguimiento_pendiente` aparte de `sheets_pendiente`**: son dos libros
distintos. Mezclarlos haría imposible leer la cola y decidir a cuál de los dos
hay que ir.

La migración lleva marca de tiempo (`npm run migracion`) y **la corre una
persona** en el editor SQL de Supabase. Hasta que se aplique, nada de lo demás
funciona.

## El circuito

```
PEDIDO  ──(se marca el pedido)──►  fila en el master, sin recepción
        ──(se carga la recepción)──►  RECIBIDO, y se reescribe la fila
```

`RECIBIDO` ya existe en el enum y `ETIQUETA_ESTADO_COMPRA` ya dice que **no se
escribe** en PEDIDOS DE COMPRA: ese libro no se entera de la recepción, y está
bien así.

La fila se crea **al pasar a `PEDIDO`**, no al recibir. Es lo que hace hoy la
planilla —el RI 1969 está en la fila 1759 sin fecha de recepción— y es lo que
deja ver al área lo que está en camino.

## Pantallas

`/compras/seguimiento`, dos listas:

- **Esperando** (`PEDIDO`): lo comprado que todavía no llegó. Arranca en ~144.
- **Recibidos** (`RECIBIDO`): lo cerrado.

Filtro por área y por proveedor, y el buscador de siempre.

El formulario de recepción pide fecha estimada, fecha de recepción, cantidad
comprada, cantidad recibida y las dos de cumplió — **cada una con el dato duro
al lado**: *"llegó 9 días tarde"*, *"recibió 500 de 1.000"*. La persona decide
con el número delante y el sistema no pisa el juicio. El mismo bloque va en la
ficha del RI.

## La exportación

`lib/compras/seguimientoSheets.ts`, libro propio
(`GOOGLE_SHEETS_SEGUIMIENTO_ID`). Escribe **sólo `COMPRAS CON RI`**: las
pestañas por área recalculan su `FILTER` solas, y sus columnas `A:M` están
protegidas contra esta cuenta de todos modos.

| Col | Qué va |
|---|---|
| A `NºRI` | `nro_ri` |
| B `CODIGO` | `codigo` |
| C `ÁREA` | nombre del área — coincide exacto con el `FILTER` |
| D `Descripción` | `descripcion` |
| E `Proveedor` | nombre del proveedor |
| F `¿Quién compro?` | `empresaParaPlanilla(empresa, paga_ambas)`, que ya existe |
| G `Cant Pedida` | `cantidad_comprada ?? cantidad` |
| H `Cant Recibida` | `cantidad_recibida` |
| I `Fecha estimada` | `fecha_estimada_recepcion`, en d/m |
| J `Fecha de recepción` | `fecha_recepcion`, en d/m |
| K `MAIL_ENVIADO` | **nunca se escribe** |
| L `Cumplió COMPRAS?` | `Si` / `Más o menos` / `No` |
| M `Cumplió PROV?` | ídem |

### Tres reglas duras

**1. `MAIL_ENVIADO` es de la planilla.** Un Apps Script
(`triggerPedidoRecibidoTiempo`) barre el master buscando filas con fecha de
recepción y sin `MAIL_ENVIADO`, le manda el aviso al mail del área
(`NotificadorPedidoRecibido`) y estampa `SI`. El SdG **no puede** mandar ese
mail: no hay transporte de correo en el proyecto —Remises usa web push, no
mail— ni dirección por área en la base. Así que el aviso se queda donde está y
funciona solo.

La consecuencia es la regla: **si al reescribir una fila el SdG pisara la K con
vacío, el barrido vería "fecha sin mail" y el área recibiría el aviso de
nuevo.** `null` significa "no corresponde escribir esta celda", igual que la
celda `LINK` de la comparativa en el otro libro.

**2. Nunca `append`, nunca insertar, nunca ordenar.** Debajo de la última fila
real (la 1759) hay 362 filas con `#N/A` hasta la 2121. `values.append` no
escribe después de los datos: escribe después de **todo**, así que mandaría la
fila nueva a la 2122 — es el bug que ya costó los presupuestos del RI 1865 en la
comparativa "ESPIRA SINFIN", donde la app decía haberlos escrito y no aparecían.
La fila libre se busca **por la columna A** y se escribe en un rango explícito.
Y ordenar o insertar en el medio correría la salida del `FILTER`: cada
`Se aplicó?` de cada área pasaría a describir el RI de al lado, sin que nada
avise.

**3. Toda ruta que toque un campo exportado tiene que exportar**, y si no puede,
dejar el motivo en `seguimiento_pendiente` **con lo que dijo Google, sin
traducir**, y decírselo a quien hizo la acción. El reintento entra en la misma
corrida del cron de Compras.

## La importación del histórico

Una sola vez, cruzando por `nro_ri` —probado: cero huérfanos—. Carga cantidad
comprada y recibida, las dos fechas, las dos de cumplió, y anota
`seguimiento_fila`. Los 1.661 con fecha de recepción quedan en `RECIBIDO`.

- Fechas con `fechaDeSheets()`: van en **d/m**, no m/d. Leerlo al revés ya dio
  vuelta 885 fechas en Compras.
- Cantidades no numéricas —hay un `"1500x1500"`— quedan en **null y se
  informan**. No se adivinan.
- **La importación no exporta.** Esas filas ya están en la planilla: es de donde
  salen. Reescribirlas no agregaría nada y correría el riesgo de tocar la K.

## Qué se testea

Vitest sobre funciones puras en `lib/compras/`:

- `filaDeSeguimiento()`: el RI adentro, la fila de 13 celdas afuera. Incluye
  que la K sea `null` y que las fechas salgan en d/m.
- `comoLeLlego()`: el dato duro que se muestra al lado del juicio —"llegó 9 días
  tarde", "recibió 500 de 1.000", "llegó a tiempo"—, con los bordes: sin fecha
  estimada, sin cantidad, cantidad recibida mayor a la pedida (pasa: el RI 219
  recibió 550 de 500).
- El parseo de una fila del histórico, con los casos sucios medidos.

## Riesgos asumidos

- **El SdG pisa la planilla.** Si alguien edita a mano una celda de `A:M`, se
  pierde en la próxima exportación. Es la misma dirección que Producción.
- **Si alguien ordena el master, las columnas de aplicación de cada área se
  desalinean** y el SdG no se entera. No se puede evitar desde acá.
- **Los 10 RI que están en la planilla sin estar en `PEDIDO`** (6 `SIN_INICIAR`,
  3 `EN_COMPARATIVA`, 1 `PARA_COMPRAR`) se importan igual, con su estado de
  compra tal como está. No se los fuerza a `PEDIDO`: el seguimiento describe lo
  que pasó, no corrige el circuito.

## Lo que queda para la fase 2

`Se aplicó?`, `Fecha de Aplicación` y `Tiempo en Stock` (= aplicación −
recepción). Las cargan tres áreas —Mantenimiento, Almacén y Taller Vial, que son
el 92% del volumen— y viven en las pestañas por área, **de la N en adelante**,
donde la protección no llega: la cuenta puede escribir ahí.

Dos columnas de esas pestañas están al **0%** y no se traen: `Equipo` —que
además el SdG ya sabe, por `ubicacion_id`— y `OBSERVACIONES`.

Cuando llegue esa fase habrá que decidir si la aplicación es 1:1 con el RI o no.
Con ese dato en la mano se verá si conviene una tabla aparte; hoy sería adivinar.
