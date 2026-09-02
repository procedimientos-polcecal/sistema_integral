# Inventario entra al SdG — cimientos

Diseño acordado el 2 de septiembre de 2026. Es el primero de cuatro: acá van la
base de datos y el histórico. Las pantallas, el vínculo con la planilla y los
enlaces con Mantenimiento y Compras son specs aparte.

## Qué se está portando

`procedimientos-polcecal/inventario` es una PWA de almacén: **Next.js 16 + Neon
(Postgres) + Auth.js**, en uso, con login y roles, movimientos transaccionales,
faltantes, ABM de artículos y usuarios, y espejo a Google Sheets. Último commit:
29/07/2026.

Igual que con Mantenimiento, integrar no es migrar: es portar el módulo contra
las tablas que este ERP ya tiene. **Cinco de sus siete tablas ya existen en el
núcleo** —`usuarios`, `sectores`, `equipos`, `empleados`, `proveedores`—, y su
login propio con bcrypt lo reemplaza el del SdG. Nuevas de verdad son dos.

La planilla es `GESTIÓN DE ALMACÉN POLCECAL POLYSAN`
(`1ObB2NBUpEFcEEoF2RqWpj6PPofR1X9CyCwubAyYPYHI`), **la misma que Mantenimiento
ya consulta en vivo** para saber si hay stock de un repuesto. Sus dos pestañas:
`Entradas  Salidas` —el kardex, con doble espacio en el nombre— y
`Listado articulos GRAL`.

## Las decisiones

**La planilla sigue en uso y sigue mandando.** La gente del pañol va a seguir
cargando movimientos ahí, así que el kardex es la unión de lo que carga la app y
lo que carga la gente, y la fórmula de `Listado articulos GRAL`
—inicial + entradas − salidas— es el stock consolidado correcto. El SdG no
calcula el stock: lo lee.

Eso resuelve una contradicción del repo de origen, que conviene dejar escrita
porque al leerlo parece un error. El README dice "fuente de verdad: Postgres,
Sheets es espejo" y el RPC calcula el stock con bloqueo de fila; pero el último
commit agregó `POST /api/stock/sync`, que lee el stock **calculado por las
fórmulas** y lo vuelca encima de Postgres, y el Apps Script está escrito a
propósito para no tocar el stock. No son dos diseños peleados: el número del RPC
es provisorio y la planilla lo corrige. Acá se asume eso explícitamente.

**`stock_actual` es lo que dijo la planilla, con la marca de cuándo.** Un número
sin fecha se lee como si fuera de ahora. El RPC lo mueve para que quien carga vea
el efecto al instante; la sincronización lo corrige.

**El RPC se porta igual, con ids `uuid`.** El bloqueo de fila sigue sirviendo
aunque la planilla mande: evita que dos salidas simultáneas *desde la app* se
pisen entre sí en el minuto que pasa hasta la próxima sincronización.

**Dos tablas nuevas, con prefijo: `inventario_articulos` e
`inventario_movimientos`.** Compras prefija y Mantenimiento no; acá se prefija
porque `movimientos` a secas es demasiado genérico para un ERP que va a tener
contabilidad, y `articulos` chocaría con cualquier catálogo futuro.

**Los movimientos apuntan al núcleo y conservan el texto crudo al lado.** Mismo
criterio que `equipo_raw`/`equipment_id` y que `contratista`/`proveedor_id` en
Mantenimiento: la planilla dice un nombre, el enlace se completa cuando se lo
reconoce, y lo que no se reconoce queda en null y se informa. Enlazar al que se
le parece es peor que dejarlo vacío — lo decidió la 032 y vale igual acá.

**Los catálogos del núcleo no se tocan.** Esto merece una advertencia porque el
importador original hace lo contrario: arranca con `delete from sectores`,
`equipos`, `empleados` y `proveedores`. Acá esas cuatro tablas las comparten
RRHH, Mantenimiento, Remises y Compras. El importador del SdG **sólo lee** los
catálogos; no crea, no borra y no renombra.

## La carga inicial — sólo de la planilla

Se importa el `Listado articulos GRAL` y el kardex entero. **Lo que hay en Neon
se descarta y Neon se da de baja.**

Se evaluó leer Neon una vez antes de apagarlo, para rescatar movimientos que el
espejo no hubiera llegado a escribir —el espejo es best-effort y su fallo sólo
deja un `console.warn` en segundo plano, así que no hay marcador de cuáles
son—. Se descartó, y hay dos razones que lo vuelven barato:

1. **El importador original nunca cargó el kardex.** Hace `delete from
   movimientos` y no inserta ninguno: los 4.100 movimientos históricos nunca
   estuvieron en Neon. Lo único que Neon tiene son los movimientos que la app
   creó desde fines de julio.
2. **Si un movimiento no llegó a la planilla, el stock de la planilla tampoco lo
   refleja.** Ese número viene estando así desde siempre y es el que el pañol
   mira todos los días. Importando la planilla se hereda exactamente lo que ya se
   ve, sin un salto inexplicable el día del cambio.

**Riesgo asumido:** de los movimientos que la app cargó y cuyo espejo falló no
queda registro —ni quién retiró qué, ni cuándo— y no hay forma de saber cuántos
son sin mirar Neon. El stock no se ve afectado. Si aparece un dump de Neon más
adelante, el rescate se puede hacer después cruzando por código, fecha, tipo y
cantidad; no bloquea nada.

**No hay un importador aparte: la carga inicial es la primera corrida de la
sincronización.** Se había planeado un script `.mjs` que leyera un `.xlsx`, como
el de Compras, y se descartó por dos razones. La primera es que un `.mjs` no
puede importar `lib/inventario/planilla.ts` —es TypeScript—, así que habría que
duplicar el parseo sin tests y mantener dos copias que se separan. La segunda es
que acá no hace falta: **la cuenta de servicio ya lee esta planilla en
producción**, es lo que hace Mantenimiento para consultar stock. Con Compras eso
no era cierto y el script tenía sentido.

La primera corrida trae los ~2.800 artículos y el kardex entero; las siguientes
refrescan. Es idempotente por construcción: los artículos van por `codigo` y los
movimientos por su fila de la planilla.

## Lo que se construye

### 1. El módulo en el núcleo — migraciones 045 y 046

La **045** tiene una sola sentencia, `alter type modulo add value 'inventario'`,
por la misma razón que la 015: Postgres no deja usar un valor de enum nuevo hasta
que su transacción commiteó, y el cuerpo de una función que lo mencione se valida
al crearla.

La **046** trae los permisos, las dos tablas, el RPC y las policies. Los tres
roles del repo mapean uno a uno con los niveles que el SdG ya tiene:

| Repo | SdG | Puede |
|---|---|---|
| `consulta` | `lectura` | Ver stock, artículos y faltantes |
| `operador` | `edicion` | + registrar entradas, salidas y ajustes |
| `admin` | `admin` | + ABM de artículos |

Las funciones son `tiene_acceso_inventario()`, `puede_editar_inventario()` y
`es_admin_inventario()`, calcadas de las de Compras.

`MODULOS_ORDEN` en `lib/core/access.ts` suma `"inventario"`, o el módulo no
aparece en la navegación aunque el grant exista.

### 2. Las tablas

```
inventario_articulos    id uuid · codigo text unique · descripcion · ubicacion ·
                        proveedores_ref · marcas · stock_inicial · stock_actual ·
                        stock_seguridad · faltante (generada) · activo ·
                        stock_sincronizado_en · sheets_fila · created_at · updated_at

inventario_movimientos  id uuid · articulo_id fk · codigo · fecha · tipo · cantidad ·
                        stock_anterior · stock_resultante · solicitante ·
                        empleado_id fk núcleo · sector_raw + sector_id fk núcleo ·
                        equipo_raw + equipment_id fk núcleo · proveedor_raw +
                        proveedor_id fk núcleo · ri · creado_por fk usuarios ·
                        origen (app|planilla) · sheets_fila · created_at
```

`faltante` es una columna generada, `greatest(stock_seguridad - stock_actual, 0)`,
igual que en el origen.

`ri` guarda el N° de requerimiento que la planilla ya trae en su columna A. Es el
gancho con Compras y se deja listo sin usarlo todavía: el enlace a
`compras_requerimientos` es del spec 4.

`origen` distingue lo que entró por la app de lo que vino de la planilla, igual
que en `compras_requerimientos`. Sin eso, la sincronización no puede saber qué le
toca reescribir.

### 3. El parser — `lib/inventario/planilla.ts`

Las dos pestañas se leen **por encabezado con alias**, no por posición. El
importador original lee el listado por posición; acá se hace por alias porque es
lo que ya hace `lib/mantenimiento/stock.ts` sobre esa misma planilla, y porque
una columna insertada a mano corre todo lo de la derecha.

Expone `mapearListado`, `filaDeArticulo`, `mapearKardex` y `filaDeMovimiento`.
Son funciones puras y son lo que se testea.

Reglas que salen de mirar la planilla:

- Una fila del kardex tiene **entrada** o **salida**, no las dos. Con las dos, o
  con ninguna, no es un movimiento y se descarta.
- El tipo se deduce: con entrada es `entrada`, con salida es `salida`. Los
  `ajuste` los genera la app, no la planilla.
- Sin código no hay movimiento: es la columna que dice si la fila tiene datos.
- Un guión suelto es "acá no va nada", igual que en el resto del SdG.

### 4. La lectura de la planilla — `lib/inventario/sincronizar.ts`

Vive en `lib` y no en la ruta porque la van a llamar dos cosas con permisos
distintos, igual que en Mantenimiento: el botón, que exige sesión, y el reloj,
que no tiene ninguna. La ruta es `POST /api/inventario/sync` y alcanza con tener
acceso al módulo: traer de la planilla no cambia lo que la planilla dice.

Lee las dos pestañas y devuelve, además de los contadores, **qué nombres no se
pudieron reconocer** contra el núcleo, por catálogo. Un enlace que falta y nadie
ve es un reporte que miente sin avisar.

Tres cosas que decide y conviene que estén escritas:

- **Un código repetido en el listado se cuenta y se descarta.** El código es
  unique: dos filas con el mismo harían fallar el lote entero con "ON CONFLICT
  DO UPDATE command cannot affect row a second time", que es el error que ya
  frenó la sincronización de las OT.
- **Si el listado viene vacío no se toca nada.** Una planilla inaccesible no
  puede vaciar el catálogo. Es la misma regla que la sincronización de
  comparativas de Mantenimiento.
- **Si el listado entra y el kardex no se puede leer, se informan las dos
  cosas.** Perder los artículos porque falló la segunda pestaña sería peor.

Las variables: `GOOGLE_SHEETS_INVENTARIO_ID` y `GOOGLE_SHEETS_INVENTARIO_TAB` ya
están cargadas —son las de Mantenimiento—, y se suma
`GOOGLE_SHEETS_INVENTARIO_TAB_MOV` para el kardex, con
`Entradas  Salidas` por defecto.

## Tests

Sobre el parser, que es lo puro y lo que más se rompe:

- El listado: alias de columnas, una fila sin código o sin descripción, stock
  vacío contra stock cero.
- El kardex: entrada, salida, las dos a la vez, ninguna, sin código, el guión
  suelto, y la fecha —que en esta planilla ya nos costó caro dos veces en
  Compras—.
- El reconocimiento contra el núcleo: mayúsculas y acentos, lo que no está
  —que devuelve null y no un parecido—, y el resumen de lo no reconocido.

## Lo que este spec no incluye

**Las pantallas** (spec 2), **la sincronización en los dos sentidos y el arreglo
del espejo que falla en silencio** (spec 3), y **los enlaces**: que Mantenimiento
lea `inventario_articulos` en vez de la planilla, y que una entrada apunte a su
requerimiento de Compras (spec 4).

Queda pendiente de averiguar, para el spec 3: si la cuenta de servicio puede
**escribir** en esa planilla o si hay que conservar el Web App de Apps Script que
usa el repo de origen. Leer ya puede — es lo que Mantenimiento hace hoy.
