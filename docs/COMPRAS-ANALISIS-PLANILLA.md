# Análisis de la planilla PEDIDOS DE COMPRA

Relevamiento del archivo original, hecho antes de diseñar el esquema. Sirve para
entender por qué la app está modelada como está.

## Hojas

| Hoja                     | Filas con N° RI | Rol                                    |
|--------------------------|-----------------|----------------------------------------|
| `Requerimientos internos`| 1825            | Master: alta + estado de aprobación     |
| `RI MANTENIMIENTO`       | 870             | Vista por área + gestión de compra      |
| `RI ALMACÉN`             | 505             | ídem                                    |
| `RI TALLER VIAL`         | 238             | ídem                                    |
| `RI LABORATORIO`         | 58              | ídem                                    |
| `RI OTRA`                | 54              | ídem                                    |
| `RI DESPACHO`            | 21              | ídem                                    |
| `RI PRODUCCIÓN`          | 10              | ídem                                    |
| `RI CANTERA`             | 6               | ídem                                    |
| `RI INVERSIONES`         | 2               | ídem                                    |
| `APROB MAXI`             | 1703            | Tandas de aprobación con costo total    |

Las 1764 filas de las hojas por área cruzan **todas** contra el master: son
vistas filtradas, no datos independientes. Por eso en la app son un filtro por
área, no tablas separadas.

`APROB MAXI` es un listado de aprobación agrupado por día con el total gastado.
La app lo reproduce dinámicamente en `/aprobaciones` en vez de guardarlo.

## Columnas del master

`N° RI`, `FECHA`, `ÁREA`, `DESCRIPCIÓN`, `CODIGO`, `CAN`, `DONDE SE NECESITA`,
`FECHA DE REQUERIMIENTO`, `DETALLE EXTRA`, `IMAGEN COMPLEMENTARIA`, `PRIORIDAD`,
`Empresa`, `Estado`

Las hojas por área agregan: `COMPARATIVA PROVEEDORES`, `PROVEEDOR` (o
`PROVEEDOR ELEGIDO`), `COSTO + IVA`, `COSTO ENVÍO`, `PAGA`, `SOLICITA`.

Ojo: la columna de cantidad se llama `CAN` en unas hojas y `CANTIDAD` en otras,
y la de proveedor `PROVEEDOR` o `PROVEEDOR ELEGIDO`. El importador contempla
ambas.

## Valores encontrados

**Estado del master** — `APROBADA (NICO)` 1258, `APROBADA (MAXI)` 506,
`DENEGADA` 19, `EN REVISIÓN` 2, vacío 40.

El nombre entre paréntesis es **quién aprobó**, no un estado distinto. Por eso se
separó en `estado_aprobacion` + `aprobador`.

**Estado de las hojas por área** — `PEDIDO` 1636, `DENEGADO` 45,
`PARA COMPRAR (NICO)` 36, `EN PROCESO (COMPARATIVA)` 19, `APROBADO` 10,
`PARA COMPRAR (POR APROBAR)` 7, `PARA COMPRAR (MAXI)` 7.

`(POR APROBAR)` no es una persona: indica que falta la aprobación. El importador
lo distingue.

**Prioridad** — `URGENTE` 1203, `NORMAL` 229, `1 SEMANA` 174, `LEVE` 140,
`2 SEMANAS` 13.

Que el 68% sea "urgente" sugiere que la prioridad perdió capacidad de discriminar.
Vale la pena revisar el criterio con los usuarios.

**Paga** — `Ambas` 702, `Polysan` 560, `Polcecal` 502.

**Dónde se necesita** — 38 valores: plantas, talleres, oficinas y equipos móviles
concretos (`CAT 950G`, `Doosan 225 n°1`, `Autoelevador Toyota n°2`…). Se guardan
en `ubicaciones` con un campo `tipo` que los clasifica.

**Proveedores** — 172 nombres distintos que se reducen a 163 al unificar
variantes (`MORC` / `MORC SRL`, `FUNDICION NAVARRO` / `FUNDICIONES NAVARRO`,
`PINTURERIA ARCO IRIS` / `ARCO IRIS`). Los más usados: ALBERDI 209, SINGLA 165,
BER IMPORT 91, RAIZ COMERCIAL 90, TODO RULEMAN 86.

## Calidad de los datos

- Fechas y montos son celdas reales de Excel (tipo `d` y `n`), no texto: la
  importación es exacta y no hay ambigüedad día/mes.
- La fila 1 del master es una prueba (`dd` / `de`), queda importada como está.
- Hay `FECHA DE REQUERIMIENTO` claramente mal cargadas (por ejemplo `3/16/16`).
  No se corrigen en la importación: se respeta el dato original.
- 40 requerimientos sin estado quedan como `PENDIENTE`.

## Qué mejora la app sobre la planilla

- Un requerimiento vive en una fila, no duplicado entre master y hoja de área.
- El N° de RI lo asigna el servidor: no hay huecos ni repetidos.
- Historial automático de cada cambio de estado, con autor y fecha.
- Los permisos son reales: un solicitante no puede aprobarse su propio pedido.
- La comparativa de proveedores se guarda estructurada (tabla `cotizaciones`),
  no como un link a otra planilla.
