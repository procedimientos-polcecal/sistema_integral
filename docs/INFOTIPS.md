# Los `(i)` del sistema: qué dice cada uno y de dónde salió

`components/InfoTip.tsx` es el ícono de información. Este documento es el
registro de **qué texto lleva cada uno y qué lo respalda**, porque un texto que
explica mal es peor que ninguno y nadie lo nota hasta que alguien le cree.

**Cuando cambia lo que una pantalla hace, se corrige su fila.** El texto es una
afirmación sobre el sistema y envejece como cualquier otra.

Los 48 que ya existían en Mantenimiento, Remises y RRHH antes del 13/11/2026 no
están en este registro: se escribieron antes y su fuente es la propia pantalla.

Cómo se escriben: segunda persona («Cargás», «elegís»), dos o tres frases,
concretos, sin marketing. `InfoTip` recibe un `text` plano: no hay formato ni
enlaces. Y va **al lado del título, nunca adentro de algo con `overflow`**: el
globo es `fixed` justamente porque un ancestro con `overflow` lo recortaba, y
`revisar-responsive.mjs` no ve esa falla.

## Las portadas de módulo

| Pantalla | Texto | De dónde salió |
|---|---|---|
| `/cantera` | Lleva lo que pasa en la cantera: las perforaciones, voladuras y bochones con sus consumos, el destape del frente, el acarreo de los fleteros y la cubicación de los yacimientos. De ahí salen el costo por tonelada del mes y el informe mensual. | `docs/superpowers/specs/2026-09-10-cantera-design.md` y las pantallas `cantera/{registros,destape,acarreo,cubicacion,informes}`; los KPI de la portada («Costo por tonelada este mes») |
| `/compras/tablero` | Seguís los pedidos de compra desde que un área los carga hasta que llegan. Cada pedido pasa por la aprobación de gerencia y después por el circuito de Compras (comparativa, aprobación de la compra y pedido), y el tablero cuenta cuántos hay en cada estado. | `docs/COMPRAS.md`, «El circuito que modela»; el tablero cuenta por `COMPRA_LABELS[estado]` |
| `/despacho` | Registrás el camión mientras está en el predio: administración pone qué se lleva al emitir el remito y la balanza marca los cuatro horarios en vivo. Reemplaza el talonario de órdenes de carga, y la planilla la escribe el sistema. También se cargan acá las recepciones de material. | `docs/DESPACHO.md`, «Qué reemplaza» y «Alcance»; el KPI «Recepciones hoy» |
| `/facturacion` | Las facturas de proveedor entran por el buzón: el sistema lee el QR de ARCA y saca emisor, número, fecha e importe sin tipear nada. Desde ahí se deja el borrador en Odoo, y se puede revisar y confirmar sin salir del sistema. | `docs/FACTURACION.md`, introducción y «Confirmar desde el SdG» |
| `/inventario` | Es el stock del almacén: cada artículo, cada entrada y salida que se carga, y lo que quedó por debajo del stock de seguridad. Se sincroniza con la planilla del almacén, y es la planilla la que manda: un movimiento que no llegó allá no existe. | La consulta de la portada (`faltante > 0` contra `stock_seguridad`); `docs/superpowers/specs/2026-09-02-inventario-pantallas-y-espejo-design.md` y `CLAUDE.md`, «Las planillas de Google» |
| `/produccion` | Cargás el informe de fábrica de cada turno: el material en depósito, lo despachado camión por camión y la rotura. Lo producido no se carga, el sistema lo calcula contra el parte anterior. No es Calidad: el stock de envases, el de carbonilla y los ensayos del laboratorio los lleva ese sector aparte. | `docs/PRODUCCION.md`, «Qué reemplaza» y «Que la producción no se mide: se despeja»; la última frase es la distinción que `CLAUDE.md` nombra como trampa fija |
| `/remises` | Organiza el transporte en remis de los empleados entre su domicilio y la fábrica: quién tiene remis, quién está presente hoy y qué vehículos hay. Con eso se generan las hojas de ruta para imprimir o compartir. «Sin coordenadas» cuenta a los empleados cuya dirección todavía no está ubicada en el mapa. | `docs/superpowers/specs/2026-07-27-fase-3-remises-design.md`; los KPI de la portada (`lat == null` define «Sin coordenadas») |
| `/taller-vial` | Sigue la flota de equipos viales: en qué estado está cada uno (operativo, fuera de servicio o con fallas), cuánto combustible cargó y cuándo le toca el próximo service. Desde acá cargás combustible y cambiás el estado de un equipo. | Sólo la pantalla: los KPI de la portada, los dos botones y `lib/tallerVial/service.ts`. No hay documento propio del módulo |
| `/trituracion` | Cargás el parte diario de cada planta y el sistema calcula la disponibilidad y arma el informe del mes. Manda el sistema: la planilla es un respaldo que se escribe desde acá, y «Partes sin exportar» cuenta los que todavía no llegaron. | `docs/superpowers/specs/2026-09-18-trituracion-design.md` y los KPI de la portada |
| `/administracion` | Es de quien administra el SdG: quién entra, a qué módulos y con qué nivel, las empresas y sectores que comparten todos los módulos, y si las sincronizaciones con las planillas están andando. | Los tres enlaces de la propia portada y su chequeo `esAdminDelNucleo` |

## Compras

Un número de columna lleva su `(i)` en el `<th>`, como el MTBF: el globo es
`fixed` y el `overflow` de la tabla no lo recorta. Lo único que no se hace es
envolver un `(i)` en algo nuevo con `overflow`. El del título dice sólo lo de la
pantalla entera.

| Dónde | Texto | De dónde salió |
|---|---|---|
| `/compras` · título | «Urgentes sin cerrar» cuenta lo urgente que todavía no llegó a Pedido, sin mirar la aprobación de gerencia; quedan afuera Pedido, En espera, Recibido y Denegado; «urgente» lo propone quien pide. | La consulta y su comentario en `compras/page.tsx:39-48` (`prioridad = URGENTE` y cuatro estados de compra, sin `estado_aprobacion`); `docs/COMPRAS.md`, «El circuito que modela» |
| `/compras/requerimientos` · título | Qué es la lista (todas las áreas), que cada RI tiene dos estados en columnas distintas y que la columna de acciones exige permiso de edición. | `docs/COMPRAS.md`, tabla de «Pantallas» y «dos estados independientes»; `canEdit` en `RequerimientosClient.tsx` |
| `/compras/requerimientos` · columna «Compra» | «En espera» es un desvío y vuelve a la etapa donde estaba. | `lib/compras/tablero.ts` («la espera es un desvío») y `cambiarEspera()` (vuelve a `etapa_previa`) |
| `/compras/requerimientos` · columna «Descripción» | «Vencido hace N días» cuenta contra la fecha de necesidad, que suele ser «ya»; no mide atraso de Compras. (Sin cifras: la medida del 91% está en el spec.) | Spec del semáforo, «Lo que se midió» |
| `/compras/requerimientos` · columna «Costo + IVA» | Vacío no es cero; «Monto alto» mira el presupuesto en pesos más alto y no cuenta los de dólares; «Sin monto alto» incluye lo desmarcado a mano y lo que no tiene número. | Migración `20261019092428` (`compras_monto_que_se_sabe`, «RIESGO ASUMIDO»: dólares excluidos); docstring de `filtroDeMontoAlto()` |
| `/compras/aprobaciones` · «Requerimientos» | Orden por prioridad y luego antigüedad; sin prioridad al final. | `pesoPrioridad()` en `lib/compras/constants.ts` y el `sort` de `RequerimientosPendientes.tsx` |
| `/compras/aprobaciones` · columna «Prioridad» | La propone quien pide y gerencia la confirma; distingue poco. | `docs/COMPRAS.md`, «El circuito que modela» |
| `/compras/aprobaciones` · columna «Se necesita» | Suele cargarse como «ya»; no ordena nada. | Spec del semáforo, «Lo que se midió» |
| `/compras/seguimiento` · título | «Cumplió Compras» / «Cumplió el proveedor» los carga una persona; el sistema pone al lado el dato duro; la demora exige las dos fechas. | `docs/COMPRAS-ESTADO.md`, «`Cumplió COMPRAS?` y `Cumplió PROV?` no son un cálculo»; docstring de `comoLeLlego()` y `laDemora()` en `lib/compras/seguimiento.ts` |
| `/compras/requerimientos/[id]` · «Comparativa de proveedores» | La fórmula del total y la conversión de dólares: el del día mientras se compara, el grabado una vez elegido. | Migración `041_compras_total_con_descuento_del_neto.sql`; docstring de `totalEnPesos()` (`lib/compras/comparativa.ts`) y de `lib/compras/dolar.ts` |
| `/compras/configuracion` · columna «Omitidas» | Son los requerimientos ya tocados en el sistema: la planilla no los pisa. | Trigger `compras_marcar_editado_en_app` (`COMPRAS-ESTADO.md`, «La planilla manda en el alta»); `omitidas` en `importarDesdeSheets`, `lib/compras/sheets.ts` (`editado_en_app`) |
| `/mis-pedidos` · «Esperando a Compras:» | Qué cuenta el semáforo (sólo lo reclamable, por eso los chips suman menos que la lista) y qué queda sin punto; los cortes 30/90. | `lib/compras/semaforo.ts` (docstring y `esReclamable()`); `conColor()` y `contar` de `MisPedidosClient.tsx`; spec del semáforo |
| `/mis-pedidos` · al final de la franja | Con un color la lista va del más viejo al más nuevo; sin color, por número de RI. | Spec del semáforo, «El orden de la lista»; comentario de `cargar` |
| `/mis-pedidos` · columna «Qué se pidió» | Cuándo sale «Reclamar», que el texto es editable y a quién le llega: el permiso **cargado** (grant de `usuario_modulos`), no el nivel efectivo. | Spec del semáforo, «A quién le llega el reclamo»; `mis-pedidos/page.tsx:53-73`; `BotonDeReclamo` |
| `/compras/tablero` · bajo el título | Las cifras cuentan sólo lo aprobado por gerencia; el listado sin ese filtro puede mostrar más. | Docstring de `destinoDeLaEtapa()` en `lib/compras/tablero.ts`; `where estado_aprobacion = APROBADA` de la migración `030_compras_resumen_por_estado.sql` |

**`mis-pedidos` es de la Tarea 12 (transversales) y los dos últimos `(i)` quedaron
puestos acá** porque la brújula del módulo manda que el semáforo y el reclamo no
falten. Quien haga la 12 no debe agregar otros dos sobre lo mismo: si quiere
sumar uno, que sea sobre algo que éstos no dicen.

### Lo que no se escribió, y dónde se buscó

- **Proveedores: «Pedidos» y «Monto»** (y los mismos cálculos de `/compras`:
  «Principales proveedores», «Gasto por mes / empresa / área»). El código suma
  `costo_iva + costo_envio` de **todo** RI con costo o proveedor, en cualquier
  estado y sin convertir dólares, y «Gasto por mes» agrupa por `fecha` (la del
  requerimiento, no la del pedido). **No está escrito en ninguna parte**: se
  buscó en `docs/COMPRAS*.md`, en `COMPRAS-PROVEEDORES-ODOO.md` y en los
  comentarios de `proveedores/page.tsx` y `compras/page.tsx`, que sólo dicen
  «relevancia real» y el arreglo de la paginación. Antes de explicarlo hay que
  decidir si incluir denegados y recibidos es lo que se quiere.
- **«Pedidos en curso» de `/compras`** (cuenta todo `estado_compra = PEDIDO`).
  El comentario de `compras/page.tsx` habla del «arrastre» de pedidos nunca
  marcados como recibidos y de «1.171 de 1.185», pero eso **ya no es lo que dicen
  los datos**: la migración `20261019092428` mide 299 en `PEDIDO` y 1.646 en
  `RECIBIDO`, `COMPRAS-ESTADO.md` todavía habla de 1.787 en `PEDIDO` y ninguno
  recibido, y el «cartel de pedidos viejos del tablero» que ese comentario cita
  ya no existe. Con tres fuentes que discrepan, no se afirma nada.
- **«en pantalla: $…» del pie del listado de requerimientos**: suma sólo las
  filas de la página (`totalPantalla`). Sólo está en el código, sin documento ni
  docstring: no hay respaldo escrito.
- **«Pedido el …» en Seguimiento** muestra `fecha_pedido`, que
  `docs/COMPRAS.md` dice que estaba en null en los 2.220 RI (30/10/2026). No se
  comprobó contra la base si sigue así; si sí, ese renglón es «—» casi siempre.
- **Indicadores de `/compras` colgados de la tarjeta**: `KpiCard` tiene
  `overflow-hidden` y un `hover:-translate-y-0.5`; un `transform` convierte al
  ancestro en el bloque de contención de un `position: fixed`, así que el globo
  se recortaría justo al pasar el mouse. Por eso lo de «Urgentes sin cerrar»
  quedó en el título y no en la tarjeta.

### Documentos que discrepan del código (manda el código)

- **`docs/COMPRAS.md`, «La comparativa»** da el total como
  `unitario × cantidad × (1 − descuento) × (1 + IVA) + envío`. Es la fórmula
  **anterior**: la migración `041` la reemplazó por
  `unitario × cantidad × (1 + IVA) − unitario × cantidad × descuento + envío`
  (con 10% de descuento y 21% de IVA, 315,81 contra 321,90). El `(i)` dice la
  nueva. El documento sigue mintiendo; no se tocó.
- **Prioridad `URGENTE`: 68% contra 42%.** `COMPRAS.md` dice 68% del histórico y
  el spec del semáforo dice 42% de los abiertos. No se contradicen —son otro
  universo cada uno—, pero ninguno de los dos números se puso en un `(i)` porque
  envejecen y cada uno necesita su fecha.

## Calidad

Son tres frentes (carbonilla, envases y ensayos) más el histórico, y los
documentos son `docs/CALIDAD.md`, `docs/CALIDAD-ENVASES.md`,
`docs/CALIDAD-ENSAYOS.md` y `docs/CALIDAD-HISTORICO.md`. Ninguna pantalla lleva un
`(i)` de pantalla: las 18 ya tenían subtítulo. Todo lo de abajo es de número.

Un número de columna lleva su `(i)` en el `<th>`; donde el teléfono muestra una
tarjeta con la misma etiqueta (listado de Ensayos, Indicadores) el `(i)` va también
ahí. Las demás tablas de Calidad no tienen tarjetas: en el teléfono son la misma
tabla con scroll.

### Carbonilla

| Dónde | Texto | De dónde salió |
|---|---|---|
| `/calidad/carbonilla` · cuadro «Total» | Es vegetal más residual, calculado, y no la columna TOTAL de la planilla, que desde la fila 386 quedó 0,450 t por encima. Mandan los saldos por tipo. | `lib/calidad/movimientos.ts:81,114` (`total` despejado) y su docstring; `docs/CALIDAD.md`, «El `TOTAL` de la planilla está 0,450 t arriba» |
| `/calidad/carbonilla` · junto a «Odoo leído» | El botón lee primero la planilla (lo que mueve el saldo) y después controla contra Odoo; la fecha de al lado es la del **control** y no la de la lectura de la planilla; una fila vaciada en la planilla no se borra sola. | `app/api/calidad/sincronizar/route.ts` (docstring y orden de los pasos); `carbonilla/page.tsx` lee `carbonilla-odoo`; `docs/CALIDAD.md`, «La secuencia de la corrida» y «Una fila que se vacía NO se relee» |
| `/calidad/carbonilla` y `/calidad/movimientos` · columna «Vegetal» | Vegetal y Residual son el saldo después de ese movimiento y no sus toneladas; dentro de un día vale el del cierre. | Docstring de `saldoCorrido()`, `lib/calidad/movimientos.ts:125-131` |
| `/calidad/movimientos` · columna «Total» | Igual que el cuadro: calculado, no es el TOTAL de la planilla. | Las mismas dos fuentes que el cuadro |
| `/calidad/carbonilla` y `/calidad/movimientos` · columna «Origen» | «Importado» es lo leído de la planilla y desde el 13/10/2026 es el camino normal, no sólo la carga inicial; «Odoo» son filas de antes; «Balanza» la recepción de Despacho; «A mano» lo cargado en pantalla. | `lib/calidad/desdeLaPlanilla.ts:376` (la lectura deja `origen = importacion`); `desdeLaRecepcion.ts:109`; `app/api/calidad/movimientos/route.ts:71`; `docs/CALIDAD.md`, «La planilla manda, y Odoo controla» |
| `/calidad/carbonilleros` · columna «Carbón» | El tipo se declara una vez por carbonillero y sale de él y nunca del producto (Membranex factura con el mismo producto que los vegetales); una entrada toma el tipo de acá. | `docs/CALIDAD.md`, «El tipo de carbón sale del proveedor y nunca del producto»; `lib/calidad/importar.ts:135` |

### Conciliación con Odoo

| Dónde | Texto | De dónde salió |
|---|---|---|
| `/calidad/conciliacion` · «N camiones sin orden de compra» | Se aparea con una orden del **mismo proveedor** a no más de dos días, y cada orden se usa una sola vez; sólo entran las líneas con producto en la lista de «Productos de Odoo» con «cuenta» y cantidad posible (más de 0 y hasta 60 t): si no pasan, el camión sale acá aunque la orden exista; sólo camiones de carbonilleros declarados y activos de los últimos 30 días. | Docstring de `DIAS_DE_GRACIA` y de `desviosContraOdoo()`, `lib/calidad/conciliacion.ts:14-22,70-80`; el filtro `resultado !== "entra"` de `sincronizar.ts` y `reconocer.ts:86-104` (`TONELADAS_POSIBLES`, l.26) |
| `/calidad/conciliacion` · «N camiones con otra cantidad» | Se compara con la orden del mismo proveedor más parecida en cantidad, cada orden se usa una vez, y menos de 5 kg es el mismo número. | `lib/calidad/conciliacion.ts:24-25,86-96` |

### Envases

| Dónde | Texto | De dónde salió |
|---|---|---|
| `/calidad/envases` · columna «Stock» | Es el que calculó la planilla (fórmula sobre el kardex), el SdG lo lee; un movimiento cargado acá que no llegó allá no existe, y la próxima lectura trae el número sin él. | `docs/CALIDAD-ENVASES.md`, párrafo «acá manda la planilla»; docstring de `lib/calidad/envases/espejo.ts` y de `envases/StockClient.tsx` |
| `/calidad/envases/movimientos` · columnas «Rotura» y «Despacho» | Sólo lo que la pantalla no dice: no se calculan a partir de las salidas (puede haber despacho con la salida en cero). Que no descuentan stock ya lo imprime el formulario de la misma pantalla. | `docs/CALIDAD-ENVASES.md`, «`ROTURA` y `DESPACHO` se guardan y no descuentan stock» |

### Ensayos

| Dónde | Texto | De dónde salió |
|---|---|---|
| `/calidad/ensayos` · subtítulo, tras «fuera de límite» | Qué quiere decir rojo, ámbar y el guión, y que los límites son por producto: uno sin límites no se marca nunca aunque otros sí. | Docstring de `Celda` (`EnsayosClient.tsx`); `docs/CALIDAD-ENSAYOS.md`, «Tres cosas se muestran en vez de recortarse» y «Los límites nacen vacíos»; `limites.ts:79` (`delProducto`) |
| `/calidad/ensayos` · columna «Acumulado (%)» (y su etiqueta en el teléfono) | Cuántas columnas se llenan lo decide el producto (con la #325 declarada, las cuatro; si no, sólo #200); en blanco es «no va» o «no se midió» y nunca cae a la malla de al lado; el #200 de un Filler suma tres tamices y el de un Calcio ocho. | `lib/calidad/ensayos/granulometria.ts:64-114`; `docs/CALIDAD-ENSAYOS.md`, «Cuántos tamices muestra el listado» |
| `/calidad/ensayos` · columna «P. vol. (g/l)» (y teléfono) | Gramos × 1000 ÷ volumen del recipiente; el volumen es un dato de cada muestra, propuesto en 330 cc. | `lib/calidad/ensayos/determinaciones.ts`, docstring de `pesoVolumetrico()`; `docs/CALIDAD-ENSAYOS.md`, «La decisión que sale de ahí» |
| `/calidad/ensayos` · columna «Cal útil (%)» (y teléfono) | ml × 0,037 ÷ peso de la muestra titulada; el peso se guarda y viene propuesto en 3 g. | `determinaciones.ts`, `CAL_UTIL_POR_ML` y docstring de `calUtilVial()` |
| Formulario de muestra (`/nueva` y `/[id]`) · títulos «Peso volumétrico», «Cal útil vial» y «Granulometría» | Las dos fórmulas y sus valores propuestos; en granulometría, que se cargan gramos y el % lo calcula el sistema sin guardarlo. | Las mismas funciones; docstring de `granulometria()` (`granulometria.ts:3-14`) |
| `/calidad/ensayos/indicadores` · columna «Fuera» y «Fuera de límite» (y la tarjeta del teléfono) | Cuenta muestras fuera de un límite cargado; un 0 no es «todo bien», es «nada marcado contra lo que nadie cargó». | `limites.ts` (docstring del módulo y `delProducto`); `docs/CALIDAD-ENSAYOS.md`, «Los límites nacen vacíos» |
| `/calidad/ensayos/curva` · «Tamices de esta muestra» | Los chips son lo que **midió** la muestra y no lo que declara el producto: si falta uno, la curva no lo avisa (al 05/11/2026, 19 de 79 muestras). | `docs/CALIDAD-ENSAYOS.md`, «Dos riesgos asumidos», riesgo 2 |
| `/calidad/ensayos/curva` · junto a «Bajar Excel» | Los gráficos van como foto y no atados a la tabla; pensado para Excel de escritorio, en Google Sheets puede no llegar la imagen y no se probó. | `docs/CALIDAD-ENSAYOS.md`, «El pasante y el Excel de la curva» |
| `/calidad/ensayos/reporte` · subtítulo | Una columna por muestra y nunca un promedio; el guión es «no se midió». | `docs/CALIDAD-ENSAYOS.md`, «El reporte del día»; docstring de `comoSeEscribe()` en `reporte.ts:224` |
| `/calidad/ensayos/limites` · «Agregar un límite» | Retenido y acumulado de una malla son dos límites; los valores van en la unidad de salida (0 a 100 y g/l). | Comentario de `evaluarMuestra()` en `limites.ts`; `docs/CALIDAD-ENSAYOS.md`, «La única excepción es `calidad_ensayos_limites`» y «Los límites nacen vacíos» |
| `/calidad/ensayos/productos` · subtítulo | Las mallas del producto no sólo se proponen al cargar: deciden las columnas del listado; la curva no las usa. | `granulometria.ts:64-114`; `docs/CALIDAD-ENSAYOS.md`, «Cuántos tamices muestra el listado» y riesgo 2 de la curva |

### Histórico

| Dónde | Texto | De dónde salió |
|---|---|---|
| `/calidad/historico` · columna «Valor» | La escala es la lectura del sistema y no del laboratorio, y si se equivoca se corrige la etiqueta y no el número; que una fila no esté en ámbar **no prueba** que su escala esté bien (sin cifras: la medición envejece); el peso volumétrico viejo puede traer 1 % de error. Lo de «cada valor declara su escala» y «ningún número fue convertido» ya lo dice el cartel fijo de la pantalla y no se repite. | `docs/CALIDAD-HISTORICO.md`, «Lo único que hay que saber antes de tocarlo», «La aritmética no valida la escala» y «Riesgos asumidos» |

### Lo que no se escribió, y dónde se buscó

- **La tarjeta «Stock» de Envases en `/calidad` (tablero) cuenta con una
  columna en desuso, y eso es un defecto y no un hueco de explicación.**
  `calidad/page.tsx:141-145` cuenta `faltante > 0` por artículo, y la migración
  `20261013133904_envases_stock_de_seguridad_por_grupo.sql` marca esa columna
  «EN DESUSO desde el 13/10/2026: compara contra el stock de la propia fila y el
  mínimo es del grupo». La pantalla de stock usa `faltantesPorGrupo()`, así que
  las dos pueden decir números distintos de «bajo el mínimo». **No se explicó ni
  se tocó**: un `(i)` ahí defendería un número que el propio repo declara malo.
  Quien lo arregle tiene que contar grupos con `faltantesPorGrupo()`.
- **«Productos de Odoo»: pantalla y documento dicen algo que el código ya no
  hace.** `ProductosClient.tsx` («no entraron al stock») y `CALIDAD.md`, «La lista
  blanca de productos» («es lo que hace que una línea entre al stock») son de
  antes del 13/10/2026. Hoy la lista sólo la lee `lib/calidad/sincronizar.ts` (el
  control contra Odoo): la lectura de la planilla (`desdeLaPlanilla.ts`) no la
  consulta. Manda el código; no se escribió `(i)` en esa pantalla. Esa lista
  **sólo importa en Conciliación** (el `(i)` de «camiones sin orden» lo dice), y
  la pantalla de Productos no lo avisa.
- **Conciliación, «N líneas leídas»: hueco, no tooltip.** Con 0 líneas de Odoo el
  control devuelve vacío sin comparar (`sincronizar.ts:59,89`), así que los
  camiones del libro no salen como «sin orden» y la pantalla dice «sin desvíos».
  Es cierto por flujo de control, pero **ningún documento, encabezado ni
  docstring lo contesta** —¿debería devolver todos los camiones como sin orden?
  es una decisión que no está escrita—, así que se sacó el `(i)` que lo decía.
  Se buscó en `docs/CALIDAD.md`, el spec del 13/10 y los docstrings de
  `sincronizar.ts` y `conciliacion.ts`.
- **Ninguna pantalla muestra cuándo se leyó la planilla de carbonilla**, que es
  lo que mueve el saldo: la fecha visible es la del control contra Odoo
  (`carbonilla-odoo`). El `(i)` lo aclara, pero lo correcto sería mostrar la otra
  (`carbonilla-planilla`). Se buscó en `carbonilla/page.tsx` y en
  `StockClient.tsx`.
- **Los saldos «Vegetal» y «Residual» (tarjetas) y los números del tablero**
  van en `KpiCard`, que tiene `overflow-hidden` y un `transform` al pasar el
  mouse: el globo `fixed` se recortaría. Los comentarios traen cifras sobre el
  consumo (224 de 256 días, 32 sin consumo) pero sin documento que las respalde
  más allá del comentario. Qué respalda hoy al saldo (el `CALIDAD.md` dice que
  nació igualado a la planilla, «no verificado», y que el conteo físico lo
  pondría sobre una medición) **no se sabe si sigue así**: no se escribió.
- **El pasante y la «foto» de los gráficos de la curva.** Los títulos de los tres
  paneles se fotografían con `html2canvas` para el Excel, así que un `(i)` ahí
  entraría en la imagen. Que el pasante herede lo de apagar tamices (no recalcula
  y puede dar negativo) está en el documento, pero la pantalla sólo lo dice del
  acumulado.
- **Humedad (listado).** Su fórmula es la del documento pero no hay supuesto
  detrás —a diferencia de peso volumétrico y cal útil—, así que se dejó sin `(i)`.
- **Ya dicho en pantalla, no se repite:** el mínimo y el faltante por grupo en el
  stock de envases (párrafo al pie), que la rotura y el despacho no descuentan
  stock (formulario de movimientos), las dos aclaraciones del informe por período
  de envases, el promedio con su `n` en Indicadores, que cada valor del histórico
  declara su escala y que ninguno fue convertido (cartel fijo; el `(i)` de
  «Valor» agrega otra cosa: que esa escala es una lectura), las filas en ámbar y
  la humedad como fracción en la vista de planilla.
- **Cifras con fecha que no se pusieron:** «27 de 362» filas del histórico y
  «ninguna de Cal ni de Filler 2» salen de la misma medición y envejecen con cada
  reimportación; el `(i)` de «Valor» dice «una minoría» y nada más. Las únicas
  cifras que quedaron llevan su fecha (la de la curva) o son del método (0,037;
  330 cc; 3 g; 5 kg; 60 t).
- **Cuenta de colocaciones:** 27 `(i)` colocados y 31 renderizados (eran 28 y 32
  antes de sacar el de «líneas leídas»); la diferencia son los cuatro duplicados
  de la tarjeta del teléfono (P. vol., Cal útil y Acumulado en el listado de
  Ensayos, y «Fuera de límite» en Indicadores), que están bien.

## Producción

Son dos frentes que se confunden: **el parte de fábrica** (`/produccion/dia`, la
carga del parte) y **los molinos** (`/produccion/molinos` y su mes, lo que mide
el robot). Los documentos son `docs/PRODUCCION.md` y, para los molinos, su sección
«Los molinos» (desde la línea 331). Ninguna pantalla lleva un `(i)` de pantalla: la
portada ya lo tenía y las demás tienen subtítulo. No se repite lo de Calidad, que
es el otro sector.

Un número de columna lleva su `(i)` en el `<th>`; el de una tarjeta de indicador va
al lado de su rótulo. Ninguna de estas pantallas tiene una tarjeta de teléfono
aparte: las tablas siguen siendo tablas con scroll.

### Molinos

| Dónde | Texto | De dónde salió |
|---|---|---|
| `/produccion/molinos` y `/produccion/molinos/mes` (tabla de turnos señalados) · columna «Turno del robot» | Son los cuatro cortes del contador del robot (20 a 24, 00 a 04, 04 a 12, 12 a 20), no los dos del parte; el robot cuenta piedra que entra al molino y el parte producto terminado, por eso robot y parte no se suman ni se restan; 20 a 24 y 00 a 04 sólo existen en el robot. | `docs/PRODUCCION.md`, «Qué mide, y por qué no se suma con el parte de fábrica» (343-365); `formato.ts` `comoSeLeeElTurnoDelRobot` |
| `/produccion/molinos` · columna «Parada» | Es lo que falta a la marcha para llegar a la teórica del corte (4 h o 8 h; la de toda la racha en un acumulado); se despeja, no se carga; «—» en un turno sin informar o inconsistente. | `PRODUCCION.md:361-364`; `turnos.ts` `DURACION` (240/240/480/480); la propia fila (`MolinosClient.tsx`: «—» en `huerfano` e `inconsistente`) |
| `/produccion/molinos` · columna «Estado» | «Sin informar» es falta de dato y no una parada; lo normal es verlo en el día en curso porque el archivo se corta a las 9:00. | `PRODUCCION.md:434-445` (el huérfano y «el zip se corta a las 09:00»); `formato.ts` `leyendaDelEstado` |
| Molinos y mes · tarjeta «Toneladas» | La etiqueta `MATERIAL` del robot sólo es confiable con un material por turno; no se guarda y ninguna pantalla muestra material (el reparto correcto sí se guarda). Con fecha: en una medición de octubre de 2026, 11,3 % de las toneladas de Filler 1 quedaban mal. | `PRODUCCION.md:449-463`; `csv.ts`, encabezado (líneas 10-17); la fecha es aproximada, ver los huecos |
| Molinos y mes · tarjeta «Horas no trabajadas» | Se despejan (teórica − marcha); un día sin ninguna fila es planta cerrada y no suma, sólo si queda estrictamente entre el primer y el último día con datos (fuera es «sin datos»); un turno en cero dentro de un día con filas sí es parada; quedan afuera los inconsistentes y los no informados. | `PRODUCCION.md:362-364, 380-398` (el límite: 384-386); `consultas.ts` `condicionDelDia`; encabezado de `turnos.ts` (reglas 1, 2 y 4) y de `indicadores.ts` |
| Molinos y mes · tarjeta «Utilización» | Marcha sobre teórica de los turnos que cuentan; marcar «planta parada» **no la mueve**; «—» y no cero sin horas teóricas. | `PRODUCCION.md:399-407` («Y acá hay que ser preciso…»); `indicadores.ts` (`indicadoresDe(turnos, diasNoOperativos)` no recibe paradas) y su docstring de `null` |
| Molinos y mes · tarjeta «Productividad» | Las toneladas incluyen las de los inconsistentes y las horas no, a propósito: la balanza midió lo uno, el reloj falla en lo otro. «—» sin marcha. | `indicadores.ts`, encabezado (líneas 97-101) y el comentario de `productividad` |
| `/produccion/molinos/sin-explicar` · «N sin explicar» | Qué cuenta: parada que llega al mínimo y sin motivo ni «planta parada»; no entran los no informados ni los inconsistentes. | `cola.ts`, encabezado (condiciones 1 a 4 y la nota del `inconsistente`); `consultas.ts` `colaDeMolino` pasa todos los turnos desde `desde` sin otro filtro |
| `/produccion/molinos/sin-explicar` · botón «Planta parada todo el día» | Saca los cuatro turnos de la cola y **no cambia ningún indicador**; para domingo, feriado o parada programada. | `PRODUCCION.md:387-407`; ni `armarElDia` ni `armarElMes` reciben paradas, y `produccion_molino_paradas` sólo se lee en `colaDeMolino` |

### El parte de fábrica

| Dónde | Texto | De dónde salió |
|---|---|---|
| `/produccion/dia` · «Producción T1» | T1 es el turno de 4 a 12; no se carga, se despeja con la cuenta; un negativo sale en rojo y no se recorta. | `PRODUCCION.md`, «Que la producción no se mide: se despeja» y «Los cuatro estados…» (producción negativa); `produccion.ts` `produccionDelTurno`; `turnos.ts` `TURNOS` |
| `/produccion/dia` · «Producción T2» | T2 es de 12 a 20, contra el parte de 4 a 12 del mismo día; esas otras ocho horas no se registran. | `turnos.ts` `parteAnterior`; `PRODUCCION.md`, «Qué reemplaza» (las otras ocho horas no se registran) |
| `/produccion/dia` · «Producción del día» | Suma de T1 y T2; con un turno o un parte anterior faltante queda «—»; el primer parte es sólo línea de base. | `produccion.ts` `produccionDelDia`; `PRODUCCION.md`, «El primer día no va a mostrar producción, y está bien» |
| `/produccion/dia` · «Despachado» | Son bultos, no kilos; sólo renglones con producto reconocido; uno con kilos pero sin bultos suma cero. | `despachos.ts` `totalesDeDespacho` (`bultos ?? 0`, `sinProducto`) y su interfaz; `cantidades.ts`, docstring inicial (línea 14: «`bultos ?? 0`… desaparezca del total del día») |
| `/produccion/parte/[fecha]/[turno]` · «Reconocido como» (renglón de despacho) | Sólo los renglones con producto elegido suman a despachado, rotura y producción; uno «sin reconocer» se guarda pero no entra en ninguna cuenta. | `despachos.ts` `totalesDeDespacho` (el `continue` antes de sumar despachado **y** rotura) |
| `/produccion/parte/[fecha]/[turno]` · «Bultos» | Es lo que se suma como despachado; con kilos y sin bultos suma cero. | `despachos.ts` `totalesDeDespacho`; `cantidades.ts` docstring |
| `/produccion/parte/[fecha]/[turno]` · «Kilos» | No se suman; sólo sirven para el aviso de «no cierran con los bultos», que necesita bultos, producto reconocido y un kilo por unidad definido; sin eso, que no aparezca el cartel no prueba que cierre. | `despachos.ts` `desajustesDeKilos` (los `continue`) y `kilosQueCoinciden`; `PRODUCCION.md`, «Los kilos por unidad ya no son del renglón» (166-180); el único otro uso de `kilos` es guardarlo (`api/produccion/partes/route.ts`) |

### Lo que no se escribió, y dónde se buscó

- **Las tarjetas «Producido / Despachado / Rotura este mes» de la portada dicen
  «t», y lo que suman son bultos y unidades.** `page.tsx` suma `produccionCalculada`,
  `despacho` y `rotura` de `armarElMes` y los formatea como toneladas
  (`num1 … t`); `totalesDeDespacho` dice «Bultos despachados por producto» y
  Resúmenes dice «Bultos despachados» y «Unidades rotas». Lo que **no** se pudo
  determinar es qué unidad tiene el depósito (de ahí sale la producción): el
  propio `PRODUCCION.md`, «Lo que está pendiente de una persona» punto 4, dice
  que en el papel el número a veces parece kilos y a veces bultos. **Es un posible
  defecto de rótulo y no se tocó ni se explicó.** Además `KpiCard` tiene
  `overflow-hidden` y un `transform` al pasar el mouse, así que un `(i)` ahí se
  recortaría. Se buscó en `produccion/page.tsx`, `despachos.ts`, `PRODUCCION.md`
  (completo) y `ResumenesClient.tsx`.
- **Resúmenes: el «·» de las celdas de Producción.** El comentario de
  `CeldaProduccion` dice que significa «ningún turno del día tocó este producto»,
  pero `produccionDelDia([null, null])` devuelve `{}` y un día **sin ningún parte**
  también lo muestra como «·» (`mes.ts:163`). Hay dos causas y el comentario cubre
  una: no se escribió, porque el texto sería incompleto. Se buscó en
  `ResumenesClient.tsx`, `produccion.ts` y `mes.ts`.
- **«Sin informar» no siempre es «el robot no informó».** `csv.ts` descarta con un
  aviso las líneas que no puede leer (fecha inválida, hora que no es un corte, un
  valor no entero) y el turno de esa línea sale después como huérfano o queda
  absorbido en un acumulado, sin distinguirse del que el robot de verdad no trajo.
  La leyenda de `formato.ts` dice «El robot no informó este turno» y el `(i)` de
  «Estado» habla de «falta de dato». No está escrito en ningún documento qué hacer
  con eso; se anota porque cambia lo que quiere decir el estado. Se buscó en
  `PRODUCCION.md`, el spec de molinos y `csv.ts`.
- **Las cifras de utilización que dependen de la regla** (65,3 % / 75,0 % / 87,8 %
  de Filler 2 con tres reglas distintas, medidas el 03/11/2026 sobre 1.054 filas;
  85,3 % contra 82,0 % en Filler 1 según se atraviese o no un día cerrado) están
  escritas con fecha en `PRODUCCION.md:405-428` pero **no se pusieron**: envejecen
  con cada importación y el `(i)` de «Utilización» habla de la regla, no de sus
  números.
- **La fecha exacta de la medición del 11,3 %.** `PRODUCCION.md`, `csv.ts` y el
  spec dan 4.034 de 35.797 toneladas y 809 turnos, sin decir de qué corte del zip
  salieron (el control del zip del 19/10/2026 trae 36.028 toneladas, otro
  número). El `(i)` de «Toneladas» dice «una medición de octubre de 2026», que es
  lo único que los documentos permiten afirmar (el spec es del 21/10 y la sección
  del 30/10); si alguien la rehace, ahí va la fecha.
- **«Orden de trabajo (opcional)» en la cola de sin explicar.** El desplegable ofrece
  las OT no realizadas de cualquier fecha y las de los últimos 90 días
  (`filtroDeVentanaDeOt`, y está escrito), pero el campo se repite en **cada** fila
  de la cola —decenas— y un `(i)` por fila es ruido; la pantalla ya avisa cuando
  no hay acceso a Mantenimiento. No se colocó.
- **`/produccion/resumenes`: nada nuevo que explicar.** Cada tabla ya trae su
  leyenda («Bultos despachados…», «Depósito − depósito anterior + despachado +
  rotura…») y sus notas ámbar (días que no entran en el total, `%` que puede salir
  más alto). Un `(i)` repetiría lo que la pantalla dice.
- **La planilla de Google y el día 31.** El espejo tiene 30 filas, así que en un mes
  de 31 días el parte del 31 queda `sheets_pendiente` (`PRODUCCION.md`, «La
  planilla…»). El pendiente se muestra con lo que dijo el sistema en el aviso rojo
  del día, y el estado de la planilla hoy (si se ampliaron las filas) no está en
  ningún documento posterior a septiembre: no se escribió.
- **`/produccion/productos` (Renglones del parte).** «Productos que cuenta» y «sin
  definir» están explicados en su propio texto al pie y en el documento, pero es la
  pantalla de un solo rol (`admin`). No se agregó nada.
- **Cuenta de colocaciones:** 17 `(i)` colocados y 16 textos distintos, en 6
  archivos (4 en `DiaClient.tsx`, 3 en `MolinosClient.tsx`, 4 tarjetas en
  `Piezas.tsx` que se ven en las dos pantallas de molinos, 1 en `MesClient.tsx`,
  2 en `ColaClient.tsx` y 3 en `ParteClient.tsx`). Los repetidos: «Turno del
  robot» (molinos y mes) y las cuatro tarjetas, que se renderizan una vez por
  molino y por pantalla.
- **Producción de 20 a 4: ¿desaparece o la absorbe T1?** `parteAnterior` hace que T1
  (4 a 12) se calcule contra el depósito del 12 a 20 del día anterior, una
  diferencia que atraviesa esas ocho horas, así que su producción podría estar
  dentro de T1. `PRODUCCION.md:14` sólo dice que esas horas no se registran; ningún
  documento dice cuál de las dos cosas pasa. El `(i)` de T2 dice sólo lo escrito.
- **Un día cuyas únicas líneas se descartaron parece planta cerrada.** `csv.ts`
  descarta las líneas ilegibles (`if (!v) continue`); si eran todas las de un día,
  ese día queda sin filas y se toma como cerrado, sin distinguirse. La frase del
  `(i)` de «Horas no trabajadas» habla de «ninguna fila», no de «el robot no
  informó». Se buscó en `csv.ts`, `turnos.ts` y `PRODUCCION.md`; no está resuelto.

## Cantera

**Cantera no tiene documento de módulo** (no es una fila de la tabla de `CLAUDE.md`):
lo escrito vive en `docs/superpowers/specs/2026-09-10-cantera-design.md`, que cubre sólo la
fase 1 (perforación, voladura, bochones, informe), y en los docstrings de `lib/cantera/`
—`destape.ts`, `costoMaquinaDestape.ts`, `costoMaquinaOdoo.ts`, `costos.ts`, `toneladas.ts`,
`informe.ts`, `cubicacion.ts`, `pesadas.ts`, `acarreo.ts` y un comentario largo de
`consultas.ts:645-656`—. Donde el spec y el código discrepan, manda el código.

**Pantallas sin subtítulo (las cinco del escaneo):** cuatro llevan `(i)` de pantalla
(`acarreo`, `informes`, `bochones/[codigo]`, `voladuras/[codigo]`). **`destape` se descartó:**
el escaneo la marcó porque su subtítulo cae ocho líneas después del título, pero lo tiene
(`DestapeClient.tsx:208`, «El costo de destapar un frente…») y el resto de lo que hay que decir
es de número, no de pantalla. Va en las columnas de costo.

### Destape

| Dónde | Texto (resumen) | De dónde salió |
|---|---|---|
| `/cantera/destape` · columna «Costo máquina» | Horas × costo por hora del equipo ese mes: lo facturado en Odoo a su cuenta analítica + combustible estimado con el precio medio de toda la flota, ÷ horas del horómetro. Si Odoo no contesta o no hay horas medidas, queda en $0. El combustible no incluye el impuesto, así que queda por debajo del real. | `costoMaquinaDestape.ts:1-10` y `:28-30` (sin «IMPUESTO COMBUSTIBLE»), `costoMaquinaOdoo.ts:22-26` (mapa vacío, «muestra $0»), `destape.ts:98-99` (indefinido → 0) |
| `/cantera/destape` · columna «Costo MO» | **El mejor del proyecto.** Horas × lo que cobra por hora ese operario. El valor hora vive en RRHH: sin acceso a RRHH llega en 0 y la columna muestra $0 con horas cargadas, sin error. | `consultas.ts:650-656` (el comentario lo dice textual), `009_rrhh_rls.sql:63` (`rrhh_empleados_datos_select … using (tiene_acceso_rrhh())`), `20260908083338…sql:164-175` (`es_admin_sistema()` o grant `rrhh`; **no** alcanza con ser admin del módulo Cantera), `destape.ts:9-11` |
| `/cantera/destape` · columna «Costo fletero» | Horas × tarifa «horas de destape» de Acarreo vigente ese día, y el doble si el camión es grande; la del grande es exactamente el doble de la del chico. | `destape.ts:16-22` y `:52-55`, `:104-107` |
| `/cantera/destape` · columna «Costo total» | Suma de las tres; cada una puede quedar en $0 por su motivo y el total queda corto sin marca. | `destape.ts:101,110` (`costoTotal`); la pantalla no tiene ningún aviso de $0 (`DestapeClient.tsx` entero) |
| `/cantera/destape` · «Registros del mes» | El «≈ t» de un registro de fletero con viajes es viajes × promedio de toneladas por viaje de ese fletero sobre todas sus pesadas de Acarreo, sin distinguir material; sin pesadas no se estima ni se muestra. | `destape.ts:75`, `:113-121` |

### Acarreo

| Dónde | Texto (resumen) | De dónde salió |
|---|---|---|
| `/cantera/acarreo` · título | Cuánto transportó cada fletero y cuánto se le paga. Las toneladas salen de las pesadas de la balanza, que se traen de la planilla con «Actualizar»; lo que no pasa por la balanza, como las horas de destape, se carga a mano. | `acarreo/page.tsx:20-30` (docstring), `ActualizarAcarreo.tsx:11-18` |
| `/cantera/acarreo` · «Por fletero» | Cantidad × tarifa vigente ese mes; las horas de Orsatti y Schneider valen el doble; un renglón sin tarifa no suma y dice «sin tarifa»; las pesadas sin fletero reconocido no entran acá pero sí en las toneladas de abajo. | `acarreo.ts:118-127` (camión grande), `:156-190` (`resumenPorFletero`: `monto ?? 0`), `pesadas.ts:331-348` y `:357-372` |
| `/cantera/acarreo` · «Total del mes, por tipo» | Todas las pesadas del mes con tipo, se sepa o no el fletero; las columnas «Destape» de la balanza no tienen tipo y quedan afuera; horas y viajes se listan pero no suman al cartel de toneladas. | `pesadas.ts:17-19`, `:357-372` (`agruparPesadasPorTipoMes`), `acarreo.ts:216-226` y `AcarreoClient.tsx:79` (`unidad === "tonelada"`) |
| `/cantera/acarreo` · «Toneladas por yacimiento» | Cada pesada por el origen que trae la balanza, sin mirar material ni fletero; sólo D1, D6, C1 y C3 tienen tarjeta; dolomita D1 con origen PT 2, caliza de Loma Negra y piedra de Pavone/Serjen van aparte; el % es sobre las toneladas del mes, no sobre las tarjetas. | `pesadas.ts:205-212` (`ORIGENES_DE_YACIMIENTO` y la lista de lo que queda afuera), `:252-271`, `:302-322`; `AcarreoClient.tsx:238` (denominador `totalToneladas`) |

### Voladuras y bochones

| Dónde | Texto (resumen) | De dónde salió |
|---|---|---|
| `/cantera/voladuras/[codigo]` · título | Un registro con dos etapas (perforación y voladura), cada una con su monto y, para finanzas, su factura; los consumos arman el monto de la voladura. | spec `2026-09-10-cantera-design.md:145-150`; `voladuras/[codigo]/page.tsx:11-18`; `VoladuraClient.tsx:534` («De acá sale el monto de la voladura») |
| voladura · monto de «Perforación» | Metros × USD/m × TC + noches de sereno × monto por noche, el sereno sin TC; «—» si falta precio, TC o metros. | `costos.ts:16-26` (sereno «sin pasar por el TC»), `:27-45` (null) |
| voladura · toneladas y monto de «Voladura» | Toneladas estimadas por la malla (real, si no la de la perforación, si no la del yacimiento), con la de la planilla al lado y ámbar si difieren más del 15 %; la fórmula no reproduce la de la planilla vieja. Monto = (insumos + 4 %) × TC; «—» es que falta TC o consumos, no cero. | `toneladas.ts:1-22`, `:58`; `VoladuraClient.tsx:285-291` (cadena de malla), `costos.ts:67-104` |
| `/cantera/bochones/[codigo]` · título | Voladura secundaria que rompe los bloques que quedaron grandes; cargás cantidad, metros por bochón, precio y TC; la factura de finanzas se compara contra el neto. | spec `:51-54`; `costos.ts:48-54` (campos invertidos en la planilla vieja); `ConciliacionOdoo.tsx:157` |

### Registros

| Dónde | Texto (resumen) | De dónde salió |
|---|---|---|
| `/cantera/registros` · «Monto perf.» y «Monto vol.» | Lo mismo que en la voladura; «—» no es cero. | `costos.ts` (ídem) |
| `/cantera/registros` · «Toneladas» | Estimadas, no pesadas; entre paréntesis la de la planilla; ámbar si difieren más del 15 %; el informe en cambio usa la de la planilla cuando existe. | `toneladas.ts:15-22`, `consultas.ts:241-249` (comentario «Es distinto del tablero») |
| `/cantera/registros` · «Facturas» y «Factura» (bochones) | P = perforación, V = voladura; «coincide» ≤ 2 %, «revisar» más, «sin factura» sin vincular, «sin monto» sin datos; contra el importe neto. | `costos.ts:106-136` (`cruce`, `TOLERANCIA`), spec `:211-216` |
| `/cantera/registros` · bochones, «Metros perf.» | Son los metros de **cada bochón** (≤ 1), no el total; el monto es cantidad × metros × USD/m × TC. | `costos.ts:48-54`, `informe.ts:52` |

### Informe

| Dónde | Texto (resumen) | De dónde salió |
|---|---|---|
| `/cantera/informes` · título | Arriba el histórico mes a mes, abajo las tablas de un rango para exportar; no escribe prosa; cada tabla recorta con su propia fecha. | `informe.ts:1-16`, `informes/page.tsx:8-14` |
| informes · «Variación mes a mes» | Cada mes se arma como el informe; perforaciones por fin de perforación, voladuras por fecha de voladura; USD/tonelada = (perf + vol) ÷ toneladas, sin bochones; mes sin toneladas no lo tiene. | `informe.ts:13-16`, `:99`, `:344-376` |
| informes · resumen, «Toneladas» | Estimadas; las de la planilla histórica cuando existen, la fórmula de cantera sólo para lo cargado después. | `consultas.ts:241-249` |
| informes · resumen, «Costo total USD» | Perforación + voladura, sin bochones; la perforación sin TC ni sereno; la voladura con su 4 %. | `informe.ts:36-38`, `:174`, `:265` |
| informes · resumen, «Servicio USD» | 4 % de los insumos, calculado, no es un renglón. | `costos.ts:67-75` |
| informes · resumen, «Gr Expl./Ton» | Σ cantidad de insumos tipo «detonador» (kilos) × 1000 ÷ toneladas. | `informe.ts:158-166` |
| informes · resumen, «USD/Ton» | (perf + vol) ÷ toneladas sin bochones; perforación por fin de perforación y toneladas por voladura: pueden no ser de las mismas voladuras. | `informe.ts:99`, `:13-16` |
| informes · perforaciones, «Total ARS» | Metros × USD/m × TC + sereno en pesos; no es Total USD × TC. | `costos.ts:17-26`, `informe.ts:36-38` |

### Cubicación

| Dónde | Texto (resumen) | De dónde salió |
|---|---|---|
| `/cantera/cubicacion` · insignia de lectura | Residuo sobre lo volado del mes: ≤ 5 % cierra, ≤ 10 % aceptable, más revisar; «sin actividad» = sin voladuras; «Pendiente» = falta la existencia final del mes o la del anterior. | `cubicacion.ts:18-22`, `:76`, `:126-134` |
| cubicación · «Exist. inicial» | Es la final total del mes anterior; sin cierre ese mes queda «—», no cero, y sin inicial no hay stock teórico ni residuo. | `cubicacion.ts:62`, `:180-199` (`armarCierresCubicacion`) |
| cubicación · «Voladuras» | Toneladas estimadas de las perforaciones que **terminaron** ese mes aunque se hayan volado en otro; sin fecha de fin no cuenta en ningún mes; una cuya tonelada no se puede estimar entra como 0 y baja el stock teórico. | `cubicacion.ts:5-8`, `:103`, `:105` (`toneladas ?? 0`), `toneladas.ts:45` (null si falta un dato); `cubicacion/page.tsx:65-79` |

**Cuenta de colocaciones:** 30 `(i)` en 7 archivos (`DestapeClient` 5, `AcarreoClient` 4,
`InformeClient` 8, `VoladuraClient` 3, `BochonClient` 1, `CanteraClient` 6, `CubicacionClient` 3).
De los de Informe, uno es del título, uno de la serie, cinco del resumen por cantera y uno de
«Total ARS» de perforaciones.

### Lo que no se escribió, y dónde se buscó

- **Costo MO en $0 también cuando el operario no está en la lista del selector.**
  `valorHoraPorOperarioId` sale de `traerOperariosDeCantera`, que trae sólo empleados activos de
  un sector que se llame como «cantera» o «tritura» (`consultas.ts:635-662`). Un registro cuyo
  operario se dio de baja o está en otro sector queda con `operarioValorHora = null` y costo MO 0
  (`DestapeClient.tsx:44`, `destape.ts:100`), aunque el que mira tenga RRHH. El código lo hace;
  ningún comentario ni documento lo dice. Se buscó en `consultas.ts`, `destape.ts` y `DestapeClient.tsx`.
- **`costoMaquinaOdoo.ts` promete un aviso que la pantalla no tiene.** El docstring dice «el tablero
  muestra $0 con aviso» y `costoMaquinaDestape.ts:41` dice que no vale mostrar $0 porque «diría
  gratis»; `DestapeClient.tsx` no tiene ningún aviso y `costoDeRegistro` usa 0 (`destape.ts:98-99`).
  El `(i)` de «Costo máquina» dice sólo «queda en $0». Qué hay que hacer lo decide un humano.
- **Costo fletero en $0 si no hay tarifa vigente o falta el tipo de camión**, en silencio
  (`destape.ts:104-107`); en Acarreo el mismo caso dice «sin tarifa». Es comportamiento del código,
  no está explicado en ningún lado, así que no entró al `(i)`.
- **Un fletero desactivado desaparece del total de Acarreo.** `acarreo/page.tsx:51` y `page.tsx:80`
  (portada) piden `traerFleteros(supabase, true)` (sólo activos): quien tuvo movimiento ese mes y
  se dio de baja no entra ni en «Por fletero» ni en «Acarreo a pagar», mientras las toneladas sí
  lo cuentan. Ningún comentario lo menciona.
- **El cartel de Acarreo contradice al código.** `AcarreoClient.tsx:121-122` dice de las pesadas sin
  fletero «no entran en ningún total», y `acarreo.ts:197-214`, `pesadas.ts:214-229` y `:357-372` dicen
  —y el código hace— que sí entran en toneladas, yacimiento y total por tipo. El `(i)` de «Por fletero»
  dice lo que hace el código; el cartel no se tocó.
- **Tres cuentas de toneladas voladas que no dicen lo mismo.** Registros y Voladura usan la estimada
  por la malla; el Informe usa `toneladas_planilla ?? estimada` (`consultas.ts:249`); Cubicación usa
  la estimada sola (`cubicacion/page.tsx:65-79`) y la agrupa por fin de perforación mientras el
  Informe agrupa por fecha de voladura. La del Informe y la de Registros quedan explicadas; **qué
  número es «el bueno» para un mes no está escrito en ningún lado.**
- **Registros filtra por `vol_fecha` y el bochón muestra `fecha_voladura ?? fin`.** Con un rango de
  fechas, una voladura «sin volar» y un bochón que sólo tiene `fin` salen del listado
  (`consultas.ts:79-80`, `:96-97`, `tablero.ts:94`). Es la semántica del `gte`/`lte` sobre null y no
  una decisión escrita. Se buscó en `consultas.ts`, `registros/page.tsx` y el spec.
- **«Conforme» no mueve el chip ni el aviso.** El spec (`:229-231`) dice que finanzas puede marcar
  `conforme` «aunque difiera», pero `armarFilaVoladura`/`armarFilaBochon` calculan el chip sólo de
  `cruce(monto, importe)` y `contarAvisos` cuenta «revisar» aunque esté marcado conforme
  (`tablero.ts:78-79`, `:116-119`). Ningún documento dice si es lo querido; el `(i)` de «Facturas» no
  dice nada de «conforme».
- **Un renglón de consumo sin precio no suma y no avisa.** `baseDeConsumosUsd` lo saltea
  (`costos.ts:86`); con renglones pero ninguno con precio, `montoVoladura` da 0 en vez de `null`
  (`costos.ts:97-104`) mientras el informe da `null` (`informe.ts:174`). No hay texto que lo explique.
- **La fórmula de toneladas sigue sin confirmar.** Spec `:556-559` (punto 2 de «Lo que hace falta de
  una persona») y `toneladas.ts:15-22`: no reproduce la columna histórica. Los `(i)` lo dicen sin
  prometer cuál de las dos está bien; no está escrito si cantera respondió.
- **Los gramos de detonador.** `informe.ts:158-162` dice que la cantidad se carga en kilos
  «confirmado con el usuario» y el spec (`:553-555`) lista como detonadores a insumos que se cuentan
  en unidades (`detonadores x 4,8`). El `(i)` repite lo que dice el código; no se pudo cruzar con el
  catálogo real de insumos.
- **Portada: «Costo por tonelada este mes» y «Toneladas voladas».** `KpiCard` no admite un `(i)` y
  esas dos tarjetas son links o números sueltos; no se tocó el componente compartido. Su definición
  es la de la serie del Informe, ya explicada allá (`serieMensual`, `informe.ts:344-376`).
- **Cantera: `fleteros`, `tarifas-acarreo`, `insumos`, `yacimientos` y las pantallas de carga
  (`destape/cargar`, `acarreo/cargar`, `voladuras/nueva`, `bochones/nuevo`).** Se leyeron los títulos
  y subtítulos: son catálogos o formularios y lo que dicen sus rótulos alcanza; las reglas que tienen
  (`resolverFleteroDestape` deja «Orsatti» y «Dumerauf» sin resolver, `destape.ts:141-160`) viven del
  lado de la importación, no de la pantalla.
- **El cero silencioso del Destape llega a cifras sin `(i)`.** El $0 de «Costo MO» (y el de máquina y
  fletero) alimenta también las tarjetas «Costo total del mes» y «Máquina + MO propia»
  (`DestapeClient.tsx:217,220`), el total del día elegido y el costo de cada registro del detalle.
  `KpiCard` no admite `(i)` y no se tocó; el `(i)` de «Costo total» dice que el total queda corto sin
  nombrar a RRHH. Quien mire una tarjeta sin RRHH ve un total menor al real sin ninguna marca.
- **Cifras con fecha que no se pusieron:** los 354 de 7.510 pesadas sin fletero de `acarreo.ts:201`, los 7.623+ de `consultas.ts:385` y los
  valores de tarifa de `destape.ts:19-21` envejecen con cada carga.

## Mantenimiento

Los 48 que ya existían en el módulo no se tocaron. Éstos son los nuevos.

### Los tres de pantalla

| Pantalla | Texto | De dónde salió |
|---|---|---|
| `/mantenimiento/avisos` · título | Qué es un aviso, sus tres finales, que «Sin orden de trabajo» cuenta sólo los pendientes, que cualquier texto en OT ASIGNADA cuenta como con OT y que la OT gana sobre desestimado. | `finalDelAviso()` y su docstring en `lib/mantenimiento/desestimarAviso.ts` (`ot_asignada` con cualquier texto, «tener OT gana»); `estaPendiente` en `AvisosClient.tsx` |
| `/mantenimiento/ordenes-servicio` · título | OS es trabajo a un tercero, no se crea acá, y «Sin proveedor elegido» incluye pedidos sin seguimiento. | Docstring de `lib/mantenimiento/os.ts` (SERVICIOS sin columnas de seguimiento); `esperaDecision()` en `aprobacion.ts`; el conteo `!o.proveedor_elegido` en `OrdenesServicioClient.tsx`; `MANTENIMIENTO-INTEGRACION.md`, «Por eso no se puede crear una OS desde la app» |
| `/mantenimiento/equipos/[id]/checklist` · título | Un checklist por equipo y no por tipo, el obligatorio frena el guardado de la ejecución, y la ejecución guarda una copia. | `checklist/page.tsx` y `EjecucionesClient.tsx:69-76,122-129,143` (se busca por `equipment_id`, sin tipo); `api/mantenimiento/ejecuciones/route.ts:50` (`checklist_snapshot`) |

No hay documento propio del checklist: la fuente es sólo el código.

### Los de número

| Dónde | Texto | De dónde salió |
|---|---|---|
| `/mantenimiento/ordenes` · detalle, junto a «GUT» | Puntaje = G×U×T de 1 a 125, sólo con las tres notas; la «Prioridad» sale de él (>80 Alta, 30–80 Media, <30 Baja) y puede diferir de la planilla; no se exporta. | `puntajeGut()` y `PuntajeGut.tsx` (raya si falta una nota); `prioridadEfectiva()` y `CORTE_DE_PRIORIDAD` en `lib/mantenimiento/prioridad.ts`; `MANTENIMIENTO-INTEGRACION.md`, «El GUT no se exporta a ninguna planilla». `gut_orden` no se nombra: la pantalla no la imprime (migración `20261021104750`) |
| `/mantenimiento/ordenes` · «ordenar por» | «Sugerido (GUT)»: abiertas primero (todo salvo Realizado y Suspendida), luego más puntaje, empate por número más alto; sin puntaje = 27, no 0. | Docstring de `ORDENES_DEL_LISTADO` (`filtrosOt.ts`); `CERRADAS_GUT` y el docstring de `gut.ts`; `route.ts:127-130` (`gut_orden desc, ot_number desc`) |
| `/mantenimiento` · panel de atrasadas | Qué cuenta como atrasada (figura Atrasado o fecha prevista pasada), que Realizada y Suspendida nunca cuentan, y qué es «sin fecha». | Docstring de `lib/mantenimiento/alertas.ts` (`estaAtrasada`, `diasDeAtraso`) |
| `/mantenimiento` · «Ventanas para reparar» | Un día libre exige todos los sectores en «Libre» (Parcial no sirve); un sector sin plan cuenta libre si otro de su empresa tiene plan; «pendientes» son sólo OT abiertas con sector. | Docstring de `ventanasDeReparacion` (`lib/mantenimiento/dashboard.ts`); el límite del plan parcial **sólo está en el código** (`days[i] ?? "LIBRE"`, `dashboard.ts:116-121`); `page.tsx:~150-157` (estados y `sector_id` no nulo) |
| `/mantenimiento/equipos/[id]` · columna «Mano de obra» | Duración × operarios anotados × tarifa vigente; sin operarios no suma; «Ambos» cuenta uno; contratista no suma. | `horasHombreDe()`, `operariosPropios()` y `costoDelEquipo()` en `lib/mantenimiento/costoEquipo.ts` (`if (hh === 0) continue`) |
| `/mantenimiento/programacion` · título | Qué junta «No está», que sólo marca a quien tiene turno, que el franco cuenta por `fecha_descanso`, que los francos pendientes y los tomados sin día (todos los anteriores al 26/10/2026 y algunos posteriores, medido el 04/11) no abren hueco, y que la tardanza no cuenta. | `noViene()`/`estaDeFranco()`/`TIPOS_QUE_NO_SON_FALTA` en `lib/mantenimiento/disponibilidad.ts`; el bucle `for (const a of asignaciones)` de `api/mantenimiento/programacion/route.ts`; docstring de `ProgramacionClient.tsx`; `MANTENIMIENTO-INTEGRACION.md`, «De dónde salen las ausencias» |
| `/mantenimiento/programacion` · «La semana» | La grilla se calcula (ciclo de seis semanas, sin grilla guardada) y una pisada vale un solo día. | `MANTENIMIENTO-INTEGRACION.md`, «Son dos ciclos…» y «Las pisadas son por día» |
| `/mantenimiento/partes-contratista` · filtros del cuaderno | Qué es «Por confirmar» y «Dudosos», y qué frena de verdad la generación. | `cuadernoGrupos.ts:371-420` (`denunciar`, `sectores_distintos`, `sector_sin_confirmar`, `sin_sector`, `sin_fecha`, `sin_horas`); `TOPE_DE_HORAS_POR_RENGLON` y `marcarLosDiasFueraDeOrden` en `cuadernoLectura.ts` |

Ya cubiertos y sin tocar: MTBF/MTTR (`mtbf/MtbfClient.tsx`, un `(i)` por columna), el ciclo de martillos (`CicloDeOT.tsx` se explica con texto visible), el costo del equipo (notas al pie visibles) y los partes de contratista (la lista dice «ya generó»).

### Lo que no se escribió, y dónde se buscó

- **El documento se contradice sobre quién pone «Atrasado».** La sección «Las órdenes atrasadas» (línea 1738) y `alertas.ts` dicen que lo marca una persona a mano; pero las líneas 432-435 y 578-581 del mismo documento dicen que la columna M lleva `=IF(J="","",L)` y marca «Atrasado» sin que nadie lo decida, y `contraste.ts:124` coincide con éstas. El `(i)` del panel dice «figuran como Atrasado» para no elegir. Se buscó en `ordenes.ts`, `contraste.ts` y `alertas.ts`.
- **El panel de atrasadas pide `.limit(500)` sin orden antes de filtrar** (`mantenimiento/page.tsx`, `.or(estado.eq.ATRASADO,proxima_fecha.lt.hoy)`). Si los candidatos superaran 500, `resumirAtrasadas` contaría de menos en silencio. No hay texto que lo mencione.
- **«Avisos sin OT» del tablero no es «Sin orden de trabajo» de Avisos.** El tablero cuenta `work_order_id` y `ot_asignada` nulos (`page.tsx`), sin mirar `desestimado_en`; la pantalla de Avisos excluye los desestimados. Son `KpiCard`, que no admite `(i)`.
- **«OS sin terminar» del tablero** cuenta todo `fecha_realizacion` nulo, también lo que espera aprobación o está denegado. `KpiCard`: sin `(i)`.
- **«Vencidos» y «Próximos 7 días»** (`KpiCard`): no se explicó dónde están definidos.
- **Mano de obra: una OT propia con horas y sin operarios queda afuera sin entrar en `huecos`** (`costoEquipo.ts`, `if (hh === 0) continue`): no se avisa en pantalla. Tampoco está escrito si el costo de Terceros (`ordenes_servicio.costo`) lleva IVA mientras Materiales usa `costo_iva`.
- **«Qué hacer primero»** trae `?pendientes=1` con `.limit(300)`; «N órdenes esperando» se toparía en 300. Hoy no pasa (decenas) y no hay texto que lo diga.
- **El Kanban** muestra 50 por columna ordenadas por GUT y ya dice «+N más»; no se agregó nada.
- **Cifras que envejecen y no se pusieron:** medianas de carga de ausencias, cantidad de francos sin fecha, órdenes sin prioridad.
- **No leídas con detalle por tamaño** (sin `(i)` ni hueco concreto): `produccion`, `tareas-preventivas`, `configuracion`, `ejecuciones` y `mantenimientos` salvo lo ya existente, y el interior del cuaderno (agrupar, sacar un renglón, la fila TOTALES del Excel). Es la parte que queda para una segunda pasada.

## RRHH y Remises

Los 48 que ya existían (los de RRHH y los de Remises entre ellos) no se tocaron. Un `(i)` de columna va dentro del `<th>`, y las tablas de estas pantallas no tienen versión de tarjeta para el teléfono, así que no hay un segundo lugar donde repetirlos.

### Los dos de pantalla

| Pantalla | Texto | De dónde salió |
|---|---|---|
| `/rrhh/analitico` · título | Qué cuenta cada tarjeta: sólo activos; Ausentismo y Tardanza del mes en curso hasta hoy sobre todos los días salvo domingos (y sábados en sectores de lunes a viernes), con feriados y vacaciones en la cuenta pero nunca como ausencia; el ausentismo cuenta toda falta, justificada o sin clasificar; la Tardanza incluye la cargada a mano y no los retiros anticipados; la edad promedio sólo toma a quienes tienen fecha de nacimiento. | `lib/rrhh/analiticoResumen.ts`: `.eq("activo", true)` (:38), `esDiaEsperado` y el bucle de `diasEsperados`/`diasAusentes`, `tardeSet` con las manuales (:76-78) y `conFechaNacimiento`; `lib/rrhh/engine/recalcular.ts:247-258` (vacación → no ausente; ausencia cargada → ausente aunque esté justificada; feriado → no ausente); `docs/RRHH-ACTUALIZACION.md`, «El umbral de hora extra pasó de 15 a 30 minutos», último párrafo («contando como ausencia cada día que nadie clasificó») |
| `/rrhh/empleados/[id]` · nombre | Las extras no entran en la liquidación hasta validarlas con «Validar»; la validación se pierde si cambian las extras de ese día; «(manual)» es un día con horas corregidas a mano y el recálculo no lo pisa. **No es un descarte**: aunque hay una línea con legajo, empresa y sector, no dice nada de cómo funciona la ficha. | `liquidaciones/generar/route.ts:50-58` (sólo `extras_validadas`) y `lib/rrhh/planillaGeneral.ts:55-60` (docstring de `extrasSinValidar`); `recalcular.ts:266-` (`preservarValidacion`) y `asistencia/horas-manual/route.ts` (`extras_validadas: false`); `recalcular.ts:210` («corregido a mano por RRHH, no se pisa») |

### Los de número

| Dónde | Texto | De dónde salió |
|---|---|---|
| `/rrhh` · «Top 10 ausencias» | Cuenta días «ausente» (sin marcación, sin vacaciones), justificados o no; la falta sin clasificar cuenta igual; sólo activos y con los filtros de Empresa y Sector. | `dashboard/top-ausencias/route.ts` (`.eq("ausente", true)`), `dashboardHelpers.ts:28` (`activo`) y `:40` (el rango por defecto, que es lo que usa la pantalla porque no manda `periodo`); `recalcular.ts:247-250`; `docs/RRHH-ACTUALIZACION.md`, mismo párrafo que arriba |
| `/rrhh` · «Top 10 llegadas tarde / salidas tempranas» | Sólo lo que marcó el reloj, ordenado por tardanzas + retiros; la tardanza cargada a mano no entra, aunque la tarjeta «Tardes» y el Analítico sí la cuentan. | `dashboard/top-tardanzas/route.ts` (lee sólo `calculos_diarios.tarde`/`retiro_anticipado`, sin tocar `ausencias`); docstring de `ResumenHoy.tardes` en `tarjetasHoy.ts` («por el reloj o cargada a mano») y `analiticoResumen.ts:76-78` |
| `/rrhh` · «Horas extra por Sector» | Suma las extras calculadas, validadas o no; el gráfico de costo de abajo parte de lo mismo; la liquidación y la planilla sólo toman las validadas. | `dashboard/horas-extra-por-sector/route.ts` (no filtra `extras_validadas`); docstring de `extrasSinValidar` («una hora extra se paga cuando alguien la aprobó, no porque el reloj la haya registrado») |
| `/rrhh/francos` · columna «Generado el» | Es el día trabajado; el franco lo genera un domingo trabajado; un feriado entre semana se paga al 100 % (con la opción activa) pero desde el 02/11/2026 no genera franco. | Comentario de `lib/rrhh/engine/calculo.ts:83-97` (`francoGenerado: dayOfWeekUtc(fecha) === 0 && total > 0`, «por pedido del 02/11/2026»); `recalcular.ts` (`fecha_generado: f.fecha`) |
| `/rrhh/francos` · columna «Estado» | Pendiente no entra en la liquidación; tomado entra, en la planilla del período de «Generado el» y no del que se marcó. | Docstring de `horasDeFrancoAPagar` (`planillaGeneral.ts:71-90`); el mensaje de «Volver a pendiente» en `FrancosClient.tsx` dice lo mismo |
| `/rrhh/liquidaciones` · planilla, «Franco comp.» | Sólo francos tomados y en el período de su «Generado el». | Mismo docstring |
| `/rrhh/liquidaciones` · planilla, «Hs. vacaciones» | Días corridos del período dentro del rango, domingos y feriados incluidos, × horas teóricas; no salen de las marcaciones. | `diasSuperpuestos` («Días calendario») y docstring de `calcularPlanillaGeneral` en `planillaGeneral.ts`; `docs/RRHH-ACTUALIZACION.md`, «Las horas de vacaciones y enfermedad se calculan, no se guardan» |
| `/rrhh/liquidaciones` · planilla, «Hs. enfermedad» | Sólo enfermedad/accidente inculpable justificada; días hábiles y sábados; las otras licencias no aparecen en ninguna columna. | `planillaGeneral.ts:221-222` (los dos `.eq`), docstring de `diasHabilesSuperpuestos`; `RRHH-ACTUALIZACION.md`, mismo párrafo («domingos y feriados no suman») |
| `/rrhh/liquidaciones` · listado, «Estado» | Cerrar protege el período de Lenox y del Excel; una ausencia cargada después en un período cerrado se guarda y no llega al recibo, y RRHH no frena; no hay botón para reabrir, sí Eliminar. | `RRHH-ACTUALIZACION.md`, «Las tres protecciones» (:442-444 y la tabla de dos caminos, «La liquidación cerrada frena a los dos»); docstring de `periodoEstaCerrado` en `altaDeAusencia.ts` («RRHH nunca tuvo este freno»); `liquidaciones/[id]/route.ts` (el `DELETE` no mira el estado) y el comentario de `[id]/cerrar/route.ts` («No había reapertura escrita en ningún lado») |
| `/rrhh/vacaciones` · «Días tomados» | Suma los períodos cargados con ese año correspondiente sin mirar las fechas; los que vienen de Ausencias cuentan días corridos. | `vacaciones/[id]/balance/route.ts:32-34`; `diasEntre` y `sincronizarPeriodoVacaciones` en `vacacionesDeAusencia.ts`; `RRHH-ACTUALIZACION.md`, tabla de «Portado en esta pasada» (vacaciones vinculadas a la ausencia) |
| `/remises/hoy` · tarjeta de ruta, junto a «km» y «min» | Es una sola punta; salen de OSRM (servicio público sin garantía); si no contesta los km son en línea recta y los minutos salen de la velocidad de Configuración (40 si está vacía); la tarjeta no avisa cuál se usó. | `lib/remises/refrescarGeometria.ts:39-43` (los `waypoints` de ida/vuelta y el `\|\|` 40); `lib/remises/engine/osrm.ts` y `geo.ts:17` (docstring de `distanciaRuta`: «fallback cuando OSRM no está disponible»); spec de la Fase 3, líneas 328-329 («sin SLA, pueden fallar») |

**Los dos `(i)` de `/rrhh/francos` contradicen al `(i)` del título de esa pantalla**, que
ya estaba y no se tocó: ver el primer punto de la lista de abajo. Quien lo corrija tiene que
leer los tres juntos.

### Lo que no se escribió, y dónde se buscó

- **Tres `(i)` que ya estaban y hoy dicen otra cosa que el código** (no se tocaron,
  por la regla; se anotan para que alguien los corrija):
  - **«Francos compensatorios» (título)** dice «trabaja un domingo o feriado» y «los que
    no [tomados], se pagan en la liquidación». Desde el 02/11/2026 un feriado entre semana
    no genera franco (`calculo.ts:83-97`) y un franco pendiente **no** se paga
    (`planillaGeneral.ts:71-90`; el propio diálogo de la pantalla dice «Mientras esté
    pendiente sus horas no entran en la liquidación»). Los dos `(i)` agregados dicen lo
    contrario del título.
  - **«Feriados»** dice que trabajar un feriado «genera francos compensatorios». Mismo motivo.
  - **«Margen (minutos)» en Turnos** dice que pasado el margen la salida «se marca como hora
    extra a validar». La hora extra de salida tiene un umbral fijo de 30 minutos
    (`UMBRAL_EXTRA_MINUTOS`, `recalcular-puro.ts:62`) independiente del margen: coinciden mientras
    el margen sea 30 (lo es según el doc del 08/10/2026), pero no en general.
- **Asistencia: «Presentes», «Días esperados» y «% Asistencia»** (`asistencia/resumen/route.ts`).
  «Presentes» es días esperados menos las ausencias, así que **cuenta feriados y vacaciones
  como presente**, y el «% Asistencia» **suma las justificadas como asistencia** —el Analítico
  las cuenta como ausencia—. Son dos convenciones opuestas para la misma palabra y no hay
  texto que diga cuál es la querida; se buscó en `RRHH-ACTUALIZACION.md`, en
  `resumenHoy.ts`/`tarjetasHoy.ts` y en el spec de la Fase 2.
- **Asistencia: «Faltas sin clasificar (N)»** (`asistencia/faltas-sin-clasificar/route.ts`):
  es un `select("*")` **sin `traerPaginado`**, así que con un período largo el número topa en
  1.000 sin avisar, y no filtra por activos (el resumen de al lado sí). El doc dice que
  el backlog sin clasificar era de 8.237 al 17/09/2026, así que es alcanzable.
  El mismo doc exige `traerPaginado` para toda consulta que barra el padrón.
- **Las cuatro tarjetas del dashboard** (Presentes, Ausentes, Tardes, Vacaciones): la regla
  está muy bien escrita en `lib/rrhh/tarjetasHoy.ts` —incluye por qué «Ausentes» mira el último día
  hábil con fichadas—, pero `KpiCard` no admite `(i)`. Su subtítulo ya dice el día.
- **«Trabajadas» y «Teóricas» por sector** (`horas-por-sector/route.ts`): las teóricas son
  días esperados × horas teóricas, y los días esperados **incluyen vacaciones y feriados**, donde
  no hay horas; el gráfico muestra así menos trabajadas que teóricas por construcción. No está
  escrito en ningún lado.
- **El costo de horas extra** ya tiene un `(i)` que dice «Estimado» y no dice que parte de
  extras sin validar; el que se puso en «Horas extra por Sector» lo cubre sólo si se lee primero.
- **Liquidación individual vs planilla general**: `liquidaciones/generar/route.ts:65`
  (`totalBruto = normal + extra 50 + extra 100`) **no suma francos**; la planilla sí
  (`planillaGeneral.ts:285`). Para el mismo empleado y período los dos totales pueden diferir y
  ningún texto lo dice ni dice si es a propósito. Tampoco el «Total $» de la planilla incluye
  las columnas de vacaciones y enfermedad. Se buscó en `docs/RRHH-ACTUALIZACION.md` y en los
  docstrings de `planillaGeneral.ts`; el docstring de `horasDeFrancoAPagar` habla sólo de la
  planilla.
- **«Modalidad de pago» (jornal / mensual)**: el doc dice dónde vive y que la planilla filtra por
  ella; **no dice qué cambia para un mensual en el cálculo** (el código no la usa para nada más
  que filtrar). Los 12 mensuales de la corrida del 27/08/2026 envejecen.
- **Vacaciones: «Días correspondientes»** (`vacaciones/[id]/balance/route.ts`,
  `engine/vacaciones.ts`): la antigüedad se mide **al 1° de enero del año elegido**, quien
  ingresó después tiene 0 ese año, y la escala es la del sistema o la propia del empleado. Es una
  decisión que sólo está en el código —`diasCorrespondientes` no tiene docstring y la
  migración 008 sólo trae el valor por defecto—, y la escala no se edita desde ninguna
  pantalla (por búsqueda de «escala» en `app`, `components` y `lib`; no es lo mismo que probarlo).
  El doc del 27/08/2026 tampoco dice si los 8 períodos derivados quedaron finalmente en 2025.
- **Analítico, el resto**: «Empleados por género» manda a «Sin especificar» a quien no tiene el dato,
  los tramos de antigüedad son `[min, max)` y la última barra de «Índice de ausentismo por mes» es
  el mes en curso hasta hoy. Nada de eso está escrito; son los tres gráficos y las tarjetas
  «Empleados» y «Antigüedad promedio». Y **el día de hoy cuenta**: `analiticoResumen.ts` llega
  hasta hoy y el motor marca ausente a quien todavía no tiene marcación, así que a la mañana el
  ausentismo del mes incluye a quien no llegó aún. Se buscó en el doc y no está dicho. La cifra
  de «~70 %» del doc es del 17/09/2026 y no se repitió.
- **Ficha: «Validar»** (`EmpleadoDetalle.tsx:104-112`, `asistencia/validar/route.ts`): la ruta exige
  `es_admin_check`, es decir nivel **admin** de RRHH —y `nivelEnModulo` le da `admin` a todo
  `admin_sistema`—, pero el botón aparece para cualquiera con acceso al módulo y `validar()`
  **ignora la respuesta**: quien no es admin aprieta y no pasa nada ni se avisa. No hay
  texto sobre eso; es un fallo mudo y no se escribió un `(i)` que lo explicara.
- **Fichadas**: no se agregó nada. Las tres cargas (Lenox, Excel, manual) y el «Acreditado» ya
  tienen su `(i)`; la ventana de 7 días del cron y el riesgo de que lo más viejo no se recupere solo
  están en el doc y el `(i)` de «Traer de Lenox» ya nombra los 7 días.
- **Remises, lo que no se leyó a fondo**: `semana`, `empleados`, `historial`, `hoja-ruta/[id]/imprimir`
  y `configuracion` sólo se miraron por sus `(i)` existentes y un grep de números. La portada
  `/remises` **ya tiene** su `(i)` y los cuatro `KpiCard` no admiten uno. «Historial reciente» de la portada
  sale de las últimas 60 hojas (`.limit(60)` en `remises/page.tsx`), así que una corrida con muchas
  rutas podría quedar cortada en su grupo más viejo: no hay texto, no se midió.
- **Quedan sin leer con detalle**: `rrhh/empleados` (el listado y la importación de la planilla), `rrhh/ausencias`
  (salvo lo que toca a liquidaciones cerradas), la pestaña Francos de la ficha (mismas columnas que
  `/rrhh/francos`, sin `(i)`), y `administracion`.
- **Cifras con fecha que no se pusieron:** 54 fichadas abiertas y 73 vs 70 empleados del doc de Lenox
  (07/10/2026), 931 días corregidos y 8.237 faltas sin clasificar (27/08 y 17/09/2026).
