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
