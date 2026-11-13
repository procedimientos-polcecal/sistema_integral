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
| `/compras` · título | «Urgentes sin cerrar» deja afuera los pedidos que ya están en Pedido y los que están en espera: es lo urgente que todavía espera que Compras lo mueva. Y «urgente» lo propone quien pide, así que distingue poco. | La consulta y su comentario en `compras/page.tsx` (`SIN_INICIAR`, `EN_COMPARATIVA`, `PARA_COMPRAR`, `APROBADO`; «`EN_ESPERA` queda afuera a propósito»); `docs/COMPRAS.md`, «El circuito que modela» (la prioridad la propone quien pide y «deja de distinguir») |
| `/compras/requerimientos` · título | Dos estados independientes (aprobación y compra); «Sin aprobar» corta el circuito. | `docs/COMPRAS.md` («dos estados independientes»); `Accion()` en `RequerimientosClient.tsx` (sin `APROBADA` no ofrece paso) |
| `/compras/requerimientos` · columna «Compra» | «En espera» es un desvío y vuelve a la etapa donde estaba. | `lib/compras/tablero.ts` («la espera es un desvío») y `cambiarEspera()` (vuelve a `etapa_previa`) |
| `/compras/requerimientos` · columna «Descripción» | «Vencido hace N días» cuenta contra la fecha de necesidad, que suele ser «ya» (91% vencido el 12/11/2026). | Spec del semáforo, «Lo que se midió» |
| `/compras/requerimientos` · columna «Costo + IVA» | Vacío no es cero; «Monto alto» usa el presupuesto más alto hasta que hay costo; «Sin monto alto» incluye lo desmarcado a mano. | Migración `20261019092428` (el costo real no existe hasta que se compró; `compras_monto_que_se_sabe`); docstring de `filtroDeMontoAlto()` en `lib/compras/montoAlto.ts` |
| `/compras/aprobaciones` · «Requerimientos» | Orden por prioridad y luego antigüedad; sin prioridad al final. | `pesoPrioridad()` en `lib/compras/constants.ts` y el `sort` de `RequerimientosPendientes.tsx` |
| `/compras/aprobaciones` · columna «Prioridad» | La propone quien pide y gerencia la confirma; distingue poco. | `docs/COMPRAS.md`, «El circuito que modela» |
| `/compras/aprobaciones` · columna «Se necesita» | Suele cargarse como «ya»; margen mediano de 4 días. | Spec del semáforo, «Lo que se midió» |
| `/compras/seguimiento` · título | «Cumplió Compras» / «Cumplió el proveedor» los carga una persona; el sistema pone al lado el dato duro; la demora exige las dos fechas. | `docs/COMPRAS-ESTADO.md`, «`Cumplió COMPRAS?` y `Cumplió PROV?` no son un cálculo»; docstring de `comoLeLlego()` y `laDemora()` en `lib/compras/seguimiento.ts` |
| `/compras/requerimientos/[id]` · «Comparativa de proveedores» | La fórmula del total (IVA sobre el neto, descuento sin IVA, envío al final) y que los dólares se convierten con el dólar oficial de venta. | Encabezado de la migración `041_compras_total_con_descuento_del_neto.sql` y la columna generada `precio_total`; docstring de `lib/compras/dolar.ts` (valor de **venta**) |
| `/compras/configuracion` · columna «Omitidas» | Son los requerimientos ya tocados en el sistema: la planilla no los pisa. | Trigger `compras_marcar_editado_en_app` (`COMPRAS-ESTADO.md`, «La planilla manda en el alta»); `omitidas` en `importarDesdeSheets`, `lib/compras/sheets.ts` (`editado_en_app`) |
| `/mis-pedidos` · «Esperando a Compras:» | Qué cuenta el semáforo y qué queda sin punto (ya pedidos, en espera, denegados); de dónde salen los días y los cortes 30/90. | `lib/compras/semaforo.ts` (docstring y `esReclamable()`); spec del semáforo, «Qué entra en el semáforo»; `COMPRAS.md`, «El semáforo de pedidos y el reclamo» |
| `/mis-pedidos` · al final de la franja | Con un color la lista va del más viejo al más nuevo (sin color, por número de RI); los números cuentan el conjunto filtrado y no la página; «Reclamar» sólo en amarillo y rojo y sobre pedidos de la propia área, y menciona al grant `edicion`/`admin` de Compras. | Spec del semáforo, «El orden de la lista», «Qué cuentan los tres chips», «A quién le llega el reclamo»; comentarios de `MisPedidosClient.tsx` (`cargar`, `contar`, `BotonDeReclamo`) y de `mis-pedidos/page.tsx` (grant explícito de `usuario_modulos`) |

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
