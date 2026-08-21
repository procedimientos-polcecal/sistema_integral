# Módulo Compras

Reemplaza la planilla **PEDIDOS DE COMPRA** por un circuito con usuarios,
permisos e historial. Portado desde `procedimientos-polcecal/COMPRAS`, que era
una app suelta, y reapuntado al núcleo del SdG.

## El circuito que modela

La planilla tiene dos capas, y el módulo conserva esa separación porque son dos
decisiones de personas distintas:

1. **Alta** — un área carga un Requerimiento Interno (RI): qué necesita, cuánto,
   dónde y para cuándo. Hoja `Requerimientos internos`.
2. **Aprobación** — gerencia aprueba o deniega, y de paso **define la prioridad
   y quién paga**. Columnas `PRIORIDAD`, `Empresa` y `Estado` del master.

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
   | Pedido | — | fecha, proveedor, costo + IVA y envío |

   En la planilla el estado dice a quién le toca: `PARA COMPRAR (NICO)`. Ese
   nombre no es decorativo — **sólo esa persona puede aprobar esa compra**. Si
   hay que cambiarla, Compras reasigna.

   Cada paso deja cargado lo suyo y la app no deja avanzar sin eso: llegar a
   `PEDIDO` sin proveedor ni costo es llegar a un pedido que después nadie puede
   seguir.

   `RECIBIDO` existe en la app pero **no en el desplegable de la planilla**, así
   que no se escribe. Se define al desarrollar el seguimiento de compra.

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
| `edicion` | Gestionar la compra: proveedor, comparativa, costos, estados |
| `admin` | Además aprobar o denegar |

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
| `/compras/aprobaciones` | Cola por urgencia y antigüedad, con aprobación en tanda |
| `/compras/tablero` | Para comprar → En comparativa → Pedido |
| `/compras/proveedores` | Padrón compartido con Mantenimiento, con volumen por proveedor |
| `/compras/ubicaciones` | Catálogo de "dónde se necesita", con detección de duplicados y fusión |
| `/compras/configuracion` | Estado de la sincronización con la planilla |
| `/mis-pedidos` | Fuera del módulo: cualquier usuario pide y sigue lo suyo |

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
