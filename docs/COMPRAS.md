# Módulo Compras

Reemplaza la planilla **PEDIDOS DE COMPRA** por un circuito con usuarios,
permisos e historial. Portado desde `procedimientos-polcecal/COMPRAS`, que era
una app suelta, y reapuntado al núcleo del SdG.

## El circuito que modela

La planilla tiene dos capas, y el módulo conserva esa separación porque son dos
decisiones de personas distintas:

1. **Alta** — un área carga un Requerimiento Interno (RI): qué necesita, cuánto,
   dónde y para cuándo. Hoja `Requerimientos internos`.
2. **Aprobación** — gerencia aprueba o deniega. Columnas `PRIORIDAD`, `Empresa`
   y `Estado` del master.

   La prioridad y quién paga **las propone quien pide** cuando el pedido entra
   por el sistema, y gerencia las confirma o las cambia al aprobar. Desde el
   09/09/2026 el sistema las escribe en el master **en cada exportación** y no
   sólo al aprobar: si las escribiera al aprobar, un pedido cargado acá se vería
   en la planilla sin prioridad hasta que alguien lo apruebe, y ése es
   justamente el dato que sirve para decidir el orden.

   Esos dos campos no los fija quien pide: el área sugiere, gerencia decide. Es
   la regla real del circuito, y es lo que explica que el 68% del histórico esté
   marcado `URGENTE` — cuando la urgencia la declara el que pide, deja de
   distinguir.

   **Nacen sin valor y se muestran como «—».** No hay `NORMAL` ni `Ambas` por
   defecto: un valor por defecto es una decisión disfrazada de dato, y encima una
   que después nadie revisa porque el campo ya "tiene algo". Sin definirlos no se
   puede aprobar.

   Para que `Ambas` siga siendo expresable, quién paga tiene tres estados:
   `empresa_id` apunta a una empresa, o `paga_ambas` marca las dos, o ninguno de
   los dos y está sin definir.
3. **Compra** — el circuito propio de Compras, en la hoja `RI <ÁREA>`:

   | Estado | Quién actúa | Qué deja cargado |
   |---|---|---|
   | Sin iniciar | Compras | — |
   | En comparativa | Compras | carga los presupuestos y elige la planilla |
   | Para comprar | **NICO o MAXI** | eligen un presupuesto: elegir **es** aprobar |
   | Compra aprobada | Compras | quién la aprobó y cuándo |
   | Pedido | — | fecha, proveedor, costo + IVA y envío, y **para cuándo se espera que llegue** |

   En la planilla el estado dice a quién le toca: `PARA COMPRAR (NICO)`. Ese
   nombre no es decorativo — **sólo esa persona puede aprobar esa compra**. Si
   hay que cambiarla, Compras reasigna.

   Cada paso deja cargado lo suyo y la app no deja avanzar sin eso: llegar a
   `PEDIDO` sin proveedor ni costo es llegar a un pedido que después nadie puede
   seguir.

   `RECIBIDO` existe en la app pero **no en el desplegable de la planilla**, así
   que no se escribe. Se define al desarrollar el seguimiento de compra.

### La fecha estimada se pide al registrar el pedido (30/10/2026)

Vivía sólo en el formulario de recepción, o sea que se cargaba **cuando la cosa
ya había llegado**, que es justo cuando esa fecha no le sirve a nadie. Medido el
30/10/2026: de los **356 RI que estaban en PEDIDO** —los que alguien está
esperando— **7** tenían fecha estimada; de las 1.550 cargadas, casi todas eran
de RI ya recibidos. Quien pregunta «¿cuándo llega?» es el que no puede cerrar su
OT sin el repuesto, y la respuesta tiene que existir mientras todavía es una
espera.

Ahora la pide el modal **«Registrar el pedido»**, junto al proveedor y al costo,
y se exige para avanzar: es la misma regla de siempre —cada paso deja cargado lo
suyo—. Del formulario de recepción salió el campo editable, pero **la fecha se
sigue mostrando ahí**, al lado de «¿Cumplió Compras?»: es contra ella que se
juzga ese cumplimiento, y sin verla el juicio se da a ciegas. Corregirla —un
proveedor que avisa que se atrasa— se hace en **Gestión de compra**, en la ficha
del RI.

Tres cosas que no se deducen del código:

- **La exigencia es al *entrar* a PEDIDO, no en cada guardado que lo nombre.**
  No está en la tabla `FALTA` de la ruta por eso: el formulario de recepción
  manda `estado_compra: "PEDIDO"` en cada guardado sin fecha de recepción, así
  que metida ahí habría dejado sin poder cargarse los **349** RI que ya estaban
  en PEDIDO sin fecha. La condición es la misma con la que se dispara la orden
  de Odoo, y vive en [lib/compras/registrarElPedido.ts](../lib/compras/registrarElPedido.ts).
- **Volver de `EN_ESPERA` no la exige**, igual que no exige el proveedor ni el
  costo: volver de la espera es retomar donde estaba, y exigirle algo deja
  atrapado adentro al pedido que se frenó justamente porque le faltaba.
- **El modal se abre mucho menos de lo que parece.** Medido el 30/10/2026: de
  las **503 transiciones a PEDIDO** registradas, **5** tienen autor, y en los
  últimos 60 días fueron **299 y 1**. `fecha_pedido` está en null en los 2.220
  RI. El estado llega a PEDIDO por la **sincronización con la planilla**, casi
  siempre saltando `SIN_INICIAR → PEDIDO` de una — el mismo motivo por el que la
  orden de Odoo se mudó al importador el 02/10. Mientras mande la planilla, la
  mayoría de los pedidos va a seguir sin fecha estimada: esto la pide donde una
  persona la puede contestar, no en todos los casos. **Es el riesgo asumido y
  está decidido a pedido.**

### Y la orden de compra en Odoo se ofrece en el mismo modal

Ya se creaba sola al entrar a PEDIDO, **y en silencio**: el listado tiraba a la
basura el `orden_odoo` y el `aviso_odoo` que devuelve la ruta, así que ni el
número que contabilidad necesita ni el fallo llegaban a nadie — sólo se veían
entrando a la ficha de ese RI, y había **12 con `odoo_pendiente`**.

Ahora el modal lo dice, con un casillero **tildado por defecto** (que es lo que
el sistema venía haciendo). Lo nuevo no es crearla: es poder decir que no, y
enterarse de cómo salió. Sólo un `false` explícito la saltea — cualquier llamada
que no mande `crear_orden_odoo` la crea, como siempre. El casillero no aparece
si no hay credenciales de Odoo: ofrecer algo que no se va a hacer es peor que no
ofrecerlo.

Por eso cada requerimiento lleva **dos estados independientes**:

| Campo | Valores |
|---|---|
| `estado_aprobacion` | `PENDIENTE` · `EN_REVISION` · `APROBADA` · `DENEGADA` |
| `estado_compra` | `SIN_INICIAR` · `PARA_COMPRAR` · `EN_COMPARATIVA` · `PEDIDO` · `RECIBIDO` · `DENEGADO` |

Las hojas por área (`RI MANTENIMIENTO`, `RI ALMACÉN`, …) **no son entidades
distintas**: las 1764 filas cruzan todas contra el master, así que son vistas
filtradas. Acá son un filtro por área, no tablas separadas.

## Permisos

Los tres niveles del núcleo (`usuario_modulos.nivel`) se mapean así:

| Nivel | Puede |
|---|---|
| `lectura` | Consultar todo el circuito |
| `edicion` | Cargar comparativas y presupuestos, gestionar proveedor, costos y OC, asignar a quién le toca aprobar, y avanzar los estados del circuito |
| `admin` | Lo mismo, y además administrar el módulo: quiénes están en la lista de aprobadores |

Aprobar es más restrictivo que comprar a propósito: es una decisión sobre el
gasto, no una tarea operativa.

**Y es el único permiso donde ser administrador del sistema no alcanza.** La
planilla restringe la columna de aprobación del master a una lista de cuentas
(protección "APROBACIÓN DE GERENCIA"), y la app espeja esa misma lista: hace
falta el módulo Compras con nivel `admin`, sin atajos. Si un admin pudiera
aprobar sin estar en la lista, los dos lados dirían cosas distintas sobre quién
aprueba, justo en el control que más importa.

La lista vigente se ve en `/compras/configuracion`, para compararla con la de la
planilla. Las dos se mantienen a mano: no hay forma de leer los editores de una
protección de Google desde afuera de ella.

**El alta es la excepción**: la puede hacer cualquier usuario activo del
sistema, tenga o no el módulo, desde `/mis-pedidos`. Son nueve áreas las que
piden materiales y exigirles un permiso convertiría a Compras en un cuello de
botella. Pedir no compromete nada; aprobar y comprar sí.

## Pantallas

| Ruta | Para qué |
|---|---|
| `/compras` | Indicadores, gasto por mes/área/empresa, principales proveedores |
| `/compras/requerimientos` | Listado completo con filtros, paginado en el servidor |
| `/compras/requerimientos/[id]` | Ficha: datos, aprobación, gestión de compra, **comparativa editable** e historial |
| `/compras/para-aprobar` | Bandeja de quien aprueba: lo suyo arriba, lo de otros abajo |
| `/compras/aprobaciones` | Cola por urgencia y antigüedad, con aprobación en tanda |
| `/compras/tablero` | Para comprar → En comparativa → Pedido |
| `/compras/proveedores` | Padrón compartido con Mantenimiento, con volumen por proveedor |
| `/compras/ubicaciones` | Catálogo de "dónde se necesita", con detección de duplicados y fusión |
| `/compras/configuracion` | Estado de la sincronización con la planilla |
| `/mis-pedidos` | Fuera del módulo: cualquier usuario pide y sigue lo suyo |

**Aprobar no es un nivel: es estar en la lista** de `/compras/configuracion`.
Vale para las dos aprobaciones —la del requerimiento y la de la compra— y no
alcanza con ser administrador del módulo ni del sistema. Administrar es
configurar; aprobar es autorizar plata, y las hacen personas distintas.

Aprobar una compra pide las dos cosas: estar en la lista y ser la persona a la
que se le asignó.


## La comparativa

Los presupuestos se cargan en la ficha del RI, no en Google Sheets. El circuito
es el que sigue:

1. Compras **elige de la carpeta de Drive** la planilla de comparativa de ese
   artículo. Los nombres de los archivos son genéricos y no dicen a qué RI
   corresponden, así que lo elige la persona; el vínculo real es la columna A.
2. Compras **carga cada presupuesto** en un formulario con los campos de la
   planilla: proveedor, marca, unidad, precio unitario, cantidad, envío,
   descuento, IVA, hasta cuándo vale el precio, plazo de pago, condiciones,
   disponibilidad y comentario. Cada uno queda también como fila en la planilla.
3. Compras pasa el RI a **Para comprar** y designa a quién le toca.
4. Esa persona **aprueba la compra eligiendo un presupuesto**. Es un solo acto.
5. Al registrar el **Pedido**, el proveedor y los costos se bajan del
   presupuesto elegido en vez de tipearse otra vez.

**Cuántos presupuestos alcanza lo decide Compras.** No hay mínimo: hay casos de
proveedor único y casos urgentes donde exigir tres frena el pedido sin motivo. Lo
único que se exige para avanzar es que haya algo que mirar.

**El total suma el envío.** La fórmula de la planilla lo dejaba afuera, y eso
hace que dos presupuestos no sean comparables cuando uno cobra el flete y el otro
no. Lo calcula la base, en una columna generada, para que la cuenta viva en un
solo lugar:

```
total = unitario × cantidad × (1 − descuento) × (1 + IVA) + envío
```

**La comparativa se muestra de dos formas.** Mientras Compras la arma, una fila
por proveedor: el trabajo es administrar filas. Cuando le toca decidir a la
persona asignada, la comparación pasa a ser una matriz —atributos en filas, un
proveedor por columna, con la diferencia contra el más barato— porque ahí el
trabajo es comparar. En el teléfono esa vista se convierte en tarjetas apiladas.

**Al aprobarse la compra, la comparativa se congela.** Desde ahí es el respaldo
de por qué se eligió ese precio: no se agrega, no se edita y no se borra.

## El semáforo de pedidos y el reclamo (12/11/2026)

`/mis-pedidos` pinta de verde, amarillo o rojo los pedidos que **esperan a
Compras**, y en los amarillos y rojos del área propia ofrece **«Reclamar»**:
abre el hilo de mensajes de ese RI con la pregunta redactada y los gestores de
Compras marcados. El diseño está en
[el spec](superpowers/specs/2026-11-12-compras-semaforo-y-reclamo-design.md) y
[el plan](superpowers/plans/2026-11-12-compras-semaforo-y-reclamo.md).

Seis cosas que no se deducen del código:

- **Los cortes son 30 y 90 días, y salieron de medir.** Con 10/30 quedaban 50
  de 106 en rojo y Mantenimiento abría la pantalla con 33 reclamos posibles;
  con 30/90 abre con 11. **El rojo tiene que costar poco de atender o deja de
  significar algo** — que es exactamente lo que ya le pasó a la prioridad de
  este módulo, con el 42% de los abiertos marcados `URGENTE`.
- **`EN_ESPERA` queda afuera del conjunto reclamable**, y es lo que evita que
  esto se muera en la primera semana: **9 de los 10 pedidos más viejos estaban
  ahí**, frenados a propósito. Sin excluirlos, lo primero que ve el área arriba
  de todo son pedidos que alguien congeló, y el primer reclamo se contesta con
  «ése está en espera».
- **El eje es la fecha de requerimiento y no la de necesidad.** La segunda está
  cargada en 539 de 540, pero el **91% ya está vencido** y el margen mediano
  entre pedir y necesitar es de **4 días**: la gente escribe «lo necesito ya»,
  así que esa fecha no ordena nada.
- **El destinatario sale del grant explícito de `usuario_modulos`, nunca de
  `nivelEnModulo()`.** Esa función le devuelve `admin` a todo `admin_sistema`
  sin mirar el grant: por ahí entraría una quinta persona que en Compras tiene
  `lectura` explícita. Es el mismo error que ya se pagó con
  `compras-por-aprobar`, que le llegaba a 6 personas de las cuales 3 no podían
  aprobar. Hoy los cuatro del grant coinciden con `compras_aprobadores`, pero
  son dos listas distintas por definición y pueden divergir.
- **El orden por defecto no cambia; al filtrar por un color, sí.** Medido para
  Mantenimiento —1.125 pedidos, 23 páginas— los 11 rojos caían en las páginas
  5, 6, 7, 11, 12 y 15 y **la página 1 no tenía un solo punto de color**: con
  el orden de siempre el semáforo era invisible. Y el orden sin filtro se deja
  porque esta pantalla también sirve para buscar si alguien ya pidió lo mismo,
  y eso se navega por número.
- **Hay 5 pedidos que esperan a un aprobador y no a Compras** (`estado_aprobacion
  = PENDIENTE`). Hoy no se nota porque las dos listas coinciden; el día que
  dejen de coincidir, esos reclaman a quien no decide.

Y una decisión de palabras que es una decisión de datos: el renglón dice
**«último mensaje»** y no «reclamado». El hilo guarda cualquier conversación
sobre el pedido, y el dato no sabe cuál fue un reclamo.

## Dar de alta un proveedor desde el presupuesto (24/11/2026)

### De qué empresa es el proveedor (24/11/2026)

En Odoo funcionan **dos perfiles** —POLCECAL es la `res.company` 1 y POLYSAN la
2— y en el SdG el padrón de proveedores es **uno solo**, compartido por los
catorce módulos. Esa unificación no se toca: lo que faltaba no era partir el
padrón, era que cada proveedor dijera con cuál de las dos trabaja. Hasta esta
fecha eso **no existía como dato** y lo decidía el pedido que estuviera
cotizando, que es otra cosa: el pedido dice quién paga **esa** compra.

Vive en dos columnas de `proveedores` —`empresa_id` y `trabaja_con_ambas`—,
excluyentes por el check `proveedores_empresa_o_ambas`. Se elige en el alta
(arranca en lo que dice el pedido y se puede cambiar) y se corrige después en
`/compras/proveedores`, que además filtra por empresa.

Cuatro cosas que no se deducen del código:

- **Son dos columnas y no un enum de tres valores**, para que sea la misma
  forma que `compras_requerimientos` (`empresa_id` + `paga_ambas`) y la
  traducción a company_ids de Odoo la haga **una sola función** en vez de dos
  que se parecen. Un enum `('POLCECAL','POLYSAN','AMBAS')` habría metido los
  nombres de las empresas dentro de un check constraint, que es justo lo que
  `empresas.odoo_company_id` existe para evitar.
- **Null quiere decir «no se sabe» y no rompe nada**: quien lo lea cae en el
  comportamiento anterior, deducir la empresa del pedido. Por eso la columna
  pudo nacer con 393 de las 484 filas vacías.
- **El backfill escribió sólo lo probado.** De los 130 proveedores con enlace
  en `proveedores_odoo`, **91 lo tienen en las dos empresas**: que exista un
  `res.partner` suyo en los dos perfiles prueba que las dos le compraron, así
  que ésos quedaron en `trabaja_con_ambas`. Los otros 39 —24 sólo en POLCECAL
  y 15 sólo en POLYSAN— **quedaron en null a propósito**: un enlace en una
  empresa prueba que ésa le compró, no que la otra no pueda, y escribir «sólo
  POLCECAL» ahí es enlazar al que se le parece.
- **Pedir una empresa en el filtro trae también a los de las dos**, porque el
  que le vende a las dos le vende a ésa. Lo que no entra es el que no lo
  declaró, que tiene su propia opción —«Sin declarar»—, y que es la lista que
  hay que mirar para completarlos.

La precedencia al buscar en Odoo está en `destinoDelAlta()`: manda lo que la
persona eligió, después lo que dice el pedido, y sin pedido se miran las dos
—enlazar no escribe nada allá—. Con un pedido que existe pero no dice empresa
ni AMBAS (17 de 1.024) **no** se miran las dos: se avisa, porque que el pedido
no conteste no es lo mismo que no tener pedido.


Cargando un presupuesto, el proveedor que no está en la lista se da de alta ahí
mismo, con el botón **Nuevo** al lado del selector. No es una comodidad de
pantalla: es el primer eslabón de la cadena «cargo la cotización y, si avanza,
le genero la orden de compra», que se cortaba en el último.

**El CUIT es obligatorio acá y no en `/compras/proveedores`.** No es una
inconsistencia: este camino existe para llegar a una orden de compra y aquél
no. Medido el 23/11/2026, de los 45 proveedores cotizados en 180 días que no
pueden llegar a una orden, **40 no tienen CUIT** — y sin CUIT no se puede ni
buscar si el proveedor ya está en Odoo ni crearlo sin arriesgar un duplicado en
la contabilidad. En la pantalla de administración sigue siendo opcional, porque
ahí se cargan también contratistas que nunca van a tener una orden en Odoo.

Seis cosas que no se deducen del código:

- **El alta lee Odoo y no le escribe.** Busca el `res.partner` por CUIT y lo
  enlaza si ya está; si no está, no crea nada y lo dice. **El partner nuevo se
  crea al generar la orden**, que es cuando hay una compra de verdad detrás y
  la empresa ya la decidió el RI. Crear al dar de alta habría puesto en la
  contabilidad proveedores de presupuestos que no prosperan, y el 40% de los RI
  son AMBAS, o sea dos partners por alta.
- **Elegir entre varios candidatos es `elegirPartnerDelEmisor()`**, la de
  Facturación, y **no elegir es un desenlace válido**. Sabe que un `parent_id`
  puesto es un contacto hijo —una dirección de entrega, no el proveedor—, que
  hay que ver los archivados para poder decir «está archivado» en vez de «no
  existe», y que con un empate real decide una persona. Copiar
  `cruzarProveedores()` en su lugar enlazaría en silencio a una dirección de
  entrega.
- **La búsqueda por CUIT tolera los guiones.** De 1.639 partners con `vat` en
  Odoo, 1.636 son dígitos puros y **dos tienen guiones**. Un `["vat","in",…]`
  no los encuentra, la pantalla diría «no está en Odoo» y la orden crearía el
  partner que ya existía — que no se borra una vez que tiene documentos.
- **`supplier_rank: 1` al crear no es cosmético.** El cruce masivo de
  `/api/odoo/proveedores/enlazar` busca `[["supplier_rank", ">", 0]]`: sin eso
  el partner recién creado queda invisible para el cruce y volvería a aparecer
  como «no está en Odoo» aunque esté.
- **`/api/compras/proveedores/con-odoo` escribe `proveedores_odoo`, que es una
  tabla de `admin`.** Es un ensanche deliberado y acotado: lo que se habilita
  no es «enlazar» sino «enlazar cuando el CUIT no deja lugar a dudas». El
  enlace se deriva del CUIT tipeado y lo frenan tres cosas —el CUIT repetido en
  el padrón, el empate que no se resuelve, y el partner que ya es de otro
  proveedor del SdG, que llega como un 23505 del `unique (empresa_id,
  odoo_partner_id)` y se traduce a «puede ser el mismo cargado dos veces»—.
- **Esto no destraba a los 40 que ya están en la lista sin CUIT.** El modal es
  para el proveedor que **no está**; los que el importador de la comparativa
  creó con el nombre y nada más se completan en `/compras/proveedores`. Lo
  único que ganan es que el cartel del ensayo pase a decir la verdad: que falta
  el CUIT, no el enlace.

No hizo falta ninguna migración. El diseño está en
[el spec](superpowers/specs/2026-11-23-compras-alta-de-proveedor-desde-el-presupuesto-design.md)
y el plan en
[el plan](superpowers/plans/2026-11-24-compras-alta-de-proveedor-desde-el-presupuesto.md),
con la lista de lo que **sólo se puede comprobar en la primera corrida real** —
el Odoo de local es staging y está congelado desde el 11/09/2026—. La primera
prueba va con un RI de **una sola empresa**, no con uno de AMBAS: si algo sale
mal, hay un partner que archivar y no dos.

## Integración con el resto del SdG

- **Proveedores viven en el núcleo**, no dentro de Compras. Mantenimiento ya
  guardaba el contratista de cada OT como texto libre; ahora
  `ordenes_trabajo.proveedor_id` apunta al mismo padrón, sin perder el texto
  original (mismo patrón que `equipo_raw` / `equipment_id`).
- **"Dónde se necesita"** es un catálogo propio (`compras_ubicaciones`) con las
  38 ubicaciones de la planilla. No se usan los `sectores` del núcleo porque
  son organizativos (Calidad, Finanzas) y no lugares físicos: ninguno cruza.
  Cada ubicación puede apuntar opcionalmente a un sector o a un equipo, y ese
  enlace vive en el catálogo, no en cada requerimiento — cuando se cargue la
  flota real hay que mapear 38 filas una vez, no 1825. `ubicacion_raw` conserva
  el texto original de la planilla como respaldo.
- **"Paga: Ambas"** se guarda como `empresa_id = null`, igual que
  `sectores.transversal` resuelve el "AMBOS" de Mantenimiento. Es habitual:
  pasa en más de un tercio de los RI.

## Puesta en marcha

Aplicar las migraciones en orden:

1. `015_nucleo_compras_enum.sql` — agrega `compras` al enum de módulos.
2. `016_nucleo_ajustes_compras.sql` — padrón de proveedores y funciones de permisos.
3. `017_compras_schema.sql` — tablas del módulo.
4. `018_compras_rls.sql` — políticas.
5. `019_compras_ubicaciones.sql` — catálogo de "dónde se necesita".
6. `020_compras_aprobar_explicito.sql` — aprobar exige estar en la lista.
7. `021_compras_alias_planilla.sql` — alias de cada aprobador en la planilla.
8. `022_compras_sheets_pendiente.sql` — qué quedó sin escribir en la planilla.
9. `023_compras_sin_valores_por_defecto.sql` — prioridad y quién paga sin default.
10. `024_compras_estado_aprobado.sql` — el estado `APROBADO` (va sola).
11. `025_compras_circuito_compra.sql` — asignación y aprobación de la compra.

**Hay que correrlas de a una**, no pegadas en una sola ejecución. La 015 tiene
una sola sentencia a propósito: Postgres no deja usar un valor de enum nuevo
hasta que su transacción commitee, y el editor SQL de Supabase corre cada script
en una transacción. Si 015 y 016 van juntas, falla con
`55P04: unsafe use of new value "compras"` — porque el cuerpo de
`puede_editar_compras()` menciona `'compras'` y se valida al crear la función.

Después, dar acceso al módulo desde `/administracion/usuarios`.

### Si la base ya tuvo el repo COMPRAS suelto

Antes de portarlo, Compras existió como app aparte
(`procedimientos-polcecal/COMPRAS`, hoy archivado). Si sus migraciones llegaron
a correrse en esta base, hay dos choques:

- `rol_actual()` allá devolvía `text` y leía de `app_users`; acá devuelve
  `user_role` y lee de `usuarios`. Postgres no deja cambiarle el tipo de
  retorno a una función existente, así que **la 002 falla** con
  `42P13: cannot change return type of existing function`.
- La tabla `proveedores` ya existe con `bigserial`, y la **015 falla** al
  intentar crearla con `uuid`.

Se resuelve con `supabase/limpiar-compras-standalone.sql`, que verifica que esas
tablas estén vacías antes de borrarlas. El histórico no se pierde: se recarga
desde el xlsx con el importador.

### Importar el histórico

```bash
node scripts/import-compras/import.mjs "C:/ruta/PEDIDOS DE COMPRA.xlsx" --dry-run
```

El `--dry-run` no escribe: informa cuántos registros fusionó, cómo quedaron los
estados y cuántas ubicaciones pudo resolver contra sectores y equipos. Sin ese
flag escribe usando `SUPABASE_SERVICE_ROLE_KEY`.

Es idempotente (upsert sobre `nro_ri`), se puede correr de nuevo.

Verificado contra la planilla real: 1825 RI, 9 áreas, 163 proveedores tras
unificar variantes de nombre (`MORC` y `MORC SRL` son uno solo).

## Sincronización con Google Sheets

Ver [COMPRAS-SINCRONIZACION.md](COMPRAS-SINCRONIZACION.md).

## Notas sobre los datos

- Fechas y montos del xlsx son celdas reales de Excel, no texto: la importación
  es exacta y no hay ambigüedad día/mes.
- Hay `FECHA DE REQUERIMIENTO` mal cargadas en la planilla (por ejemplo
  `3/16/16`). No se corrigen: se respeta el dato original.
- 40 requerimientos sin estado quedan como `PENDIENTE`.
- **El 68% de los RI está marcado `URGENTE`.** La prioridad perdió capacidad de
  discriminar; vale la pena revisar el criterio con los usuarios.
