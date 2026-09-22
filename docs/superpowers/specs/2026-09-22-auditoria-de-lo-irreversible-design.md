# Auditoría: quién hizo lo que no se deshace

Acordado el 22 de septiembre de 2026. Nace de cruzar el repositorio con la
*Documentación Funcional del ERP* (capítulo 28, «Auditoría y trazabilidad», y
REG-T-18), pero el alcance **no** es el que pide ese documento: ahí se pide
auditar todo cambio de todo campo de todo módulo, y acá se arranca por las
acciones que no se pueden deshacer, que es donde hoy la pregunta «¿quién hizo
esto?» no tiene respuesta.

## Lo que se midió antes de diseñar (22/09/2026)

Contra la base de producción, con `SUPABASE_SERVICE_ROLE_KEY`.

### No es cierto que no haya nada. Hay tres cosas, y cada una cubre un pedazo

| Dónde | Qué guarda | Filas hoy |
|---|---|---|
| `compras_historial` | cada cambio de `estado_aprobacion` y `estado_compra` de un requerimiento, con valor anterior y nuevo | **2.922** |
| `inventario_movimientos` | el kardex: cada entrada, salida y ajuste con `creado_por`, `stock_anterior` y `stock_resultante`. **No se edita ni se borra** —la 046 lo dice: «un kardex que se puede reescribir no es un kardex» | **4.204** |
| `empresa_status_log`, `sectores_status_log`, `equipos_status_log` | los cambios de estado de esas tres entidades | — |

O sea que **el diseño ya existe**: `compras_historial` tiene exactamente la forma
que pide el capítulo 28 del documento funcional —`campo`, `valor_anterior`,
`valor_nuevo`, `usuario_id`, `nota`, `created_at`—. Lo que falta no es inventarla.

### Pero casi nunca dice quién, y casi nunca dice por qué

| | |
|---|---|
| Filas de `compras_historial` **con** `usuario_id` | **70** |
| Filas **sin** `usuario_id` | **2.852** (97,6%) |
| Filas con `nota` (el motivo) | **1** |

Las 2.852 las escribe el trigger `compras_requerimientos_log_estado`
(`017_compras_schema.sql`), que se dispara en el `update` y no tiene de dónde
sacar el autor. Las 70 son los cuatro lugares donde la ruta inserta a mano.

**Ésta es la medición que decide el mecanismo.** Un trigger atrapa todo cambio,
incluso un `update` a mano en el editor SQL — y ése es su valor real. Pero no
sabe quién ni por qué, y en este repo eso no se arregla con `auth.uid()`:

> **60 de las 125 rutas que escriben usan `createAdminClient()`**, que va con la
> service role y no lleva JWT. Ahí `auth.uid()` es `null` siempre. Ya está
> anotado en `app/api/inventario/movimientos/route.ts`, donde costó un rato
> entender por qué todo movimiento moría con un error de permisos.

Y la mitad admin no es la mitad aburrida: es justo donde se escribe salteando
RLS, o sea lo sensible.

### Y una parte del movimiento no tiene autor humano, a propósito

De los **2.015** requerimientos, sólo **9** tienen `aprobado_por` cargado. No es
un bug: la mayoría de los estados de Compras entran **por la sincronización de
la planilla**, donde quien movió la fila no es un usuario del SdG. Una auditoría
honesta tiene que poder decir *«esto lo movió la sincronización de las 09:15
leyendo la fila 1.284 de la planilla»*, y no dejar el campo vacío como si fuera
lo mismo que no saber.

### Dónde no hay absolutamente nada

| Acción | Se deshace | Qué queda registrado hoy |
|---|---|---|
| **Postear un asiento en Odoo** (`POST /api/facturacion/facturas/[id]/odoo/borrador`) | **No.** Un asiento posteado es inmutable, Odoo no lo deja volver atrás | **Nada sobre quién.** La ruta comprueba `puedeConfirmarEnOdoo(user)` y después llama a `confirmarElBorrador(createAdminClient(), id)`. El id del usuario no se persiste en ningún lado. `facturas_proveedor` tiene `odoo_conciliado_por` y `cargado_por`, pero no un «posteado por» |
| **Conceder o quitar un módulo a un usuario** (`/api/administracion/usuarios/[id]/modulos`) | Sí, pero sin rastro | **Nada.** `usuario_modulos` son 72 filas con `id, usuario_id, modulo, nivel` y ni una columna de cuándo ni de quién |
| **Cerrar una liquidación** (`PUT /api/rrhh/liquidaciones/[id]/cerrar`) | No hay reapertura escrita | **Nada sobre quién.** El `update` pone `estado: "CERRADA"` y se va |
| **Ajustar el stock** | Se corrige con otro ajuste | **Sí**, y bien: el kardex es append-only con `creado_por` |
| **Aprobar o denegar una compra** | Sí | **A medias**: el estado queda en el historial, el autor casi nunca |

El caso de arriba de todo es el que manda este diseño. Es **la única acción del
sistema que no se puede deshacer**, está reservada a administradores y exige
`confirmar: true` en el cuerpo para que no salga de un clic accidental — todo
ese cuidado, y después nadie sabe quién la ejecutó.

## Qué se decide

**El alcance arranca por lo irreversible**, no por todo. Cinco acciones:

1. Postear un asiento en Odoo.
2. Conceder, cambiar o quitar el acceso de un usuario a un módulo.
3. Cerrar una liquidación.
4. Ajustar el stock por fuera de una entrada o salida.
5. Aprobar o denegar una compra o una orden de servicio.

Se puede ampliar después sin rehacer nada: lo que se agrega es una llamada más,
no una tabla distinta.

**Se escribe desde la aplicación, no desde un trigger.** Es lo contrario de lo
que hizo Compras, y la razón está medida arriba: el trigger dio 2.852 filas sin
autor y 1 con motivo. Una auditoría que contesta «cambió de `pendiente` a
`aprobado`» pero no «quién» ni «por qué» sirve para reconstruir el estado, que
es justamente lo que el estado ya dice solo.

El precio es real y hay que decirlo: **una ruta nueva se puede olvidar de
llamarla**. Un trigger no se olvida. Se acota con tres cosas y ninguna es
perfecta:

- La llamada vive en una función de `lib/core/` con test, no repetida en cada
  ruta.
- Las cinco acciones tienen su registro en el mismo commit que este diseño.
- Queda escrito en `CLAUDE.md`, que es donde este repo guarda lo que no se
  deduce del código.

**El trigger de Compras no se saca.** Cubre lo que la app no ve —la
sincronización de la planilla, y un `update` a mano en el editor SQL— y sacarlo
sería perder eso para ganar prolijidad. Conviven: el trigger dice *qué* cambió
siempre, la llamada de aplicación agrega *quién* y *por qué* cuando hubo alguien.

## Qué guarda

Una tabla del núcleo, `auditoria`, con la forma que `compras_historial` ya probó
durante 2.922 filas, más lo que le falta:

| Campo | Por qué |
|---|---|
| `id`, `created_at` | — |
| `usuario_id` | Quién. `null` **sólo** si el autor no es una persona, y entonces `actor` lo dice |
| `usuario_nombre` | Cacheado. Un usuario dado de baja no puede dejar la auditoría sin nombre: el capítulo 28 lo pide como «ex usuario X» |
| `actor` | `persona`, `sincronizacion` o `cron`. Es lo que hoy falta para distinguir «no sé quién» de «lo movió la planilla» |
| `modulo`, `entidad`, `entidad_id` | Sobre qué |
| `accion` | `postear`, `aprobar`, `denegar`, `cerrar`, `ajustar`, `conceder_acceso`, `quitar_acceso` |
| `valor_anterior`, `valor_nuevo` | Texto, como en `compras_historial` |
| `motivo` | **Obligatorio en denegar y en ajustar.** Lo valida la función, no la base: el mensaje de error tiene que poder decir cuál falta |
| `contexto` | `jsonb`. El `odoo_move_id` del asiento, el importe, el número de RI |

### Inmutable de verdad, no por convención

El capítulo 28 pide que no se pueda modificar ni borrar «ni siquiera por el
Administrador». Acá eso son policies, y se puede hacer bien:

- `insert` para `authenticated`; **no hay policy de `update` ni de `delete`**, y
  sin policy RLS niega.
- La service role saltea RLS igual — no hay forma de evitarlo — así que además va
  un trigger `before update or delete` que levanta excepción. Eso sí frena al
  cliente admin.
- `select` sólo para `admin_sistema`, con la misma llave que `/administracion`
  (`esAdminDelNucleo`, `es_admin_sistema()`).

## Qué se testea

La función pura, que es donde están las decisiones:

- Que `denegar` y `ajustar` sin motivo devuelvan el error y no escriban.
- Que `actor` salga `sincronizacion` cuando no hay usuario y el llamador lo dice,
  y que **no** se pueda escribir una fila sin usuario y sin actor —que es
  exactamente el agujero de las 2.852 filas de hoy—.
- Que el nombre del usuario se cachee al escribir y no se lea después por join.

## Riesgos asumidos

- **Una ruta nueva se puede olvidar de auditar.** Es el costo de elegir la capa
  de aplicación, y está elegido con los ojos abiertos: ver arriba.
- **La service role puede insertar filas falsas.** Cualquiera con esa clave puede
  escribir lo que quiera en cualquier tabla; una auditoría no la contiene. Lo que
  la tabla protege es el error y el olvido, no a un atacante con la llave del
  proyecto.
- **No cubre las lecturas.** El capítulo 28 pide auditar el acceso a información
  sensible y la exportación masiva. Queda afuera: hoy no hay ninguna pantalla
  que lo pida y sería mucho volumen para poco.

## Lo que queda afuera a propósito

- **Auditar todo cambio de todo campo** (REG-T-18). Para esto haría falta un
  trigger genérico por tabla, y volveríamos a las filas sin autor.
- **Los diez años de retención** del capítulo 28. Sin una política de purga, la
  tabla crece y ya está; poner la purga antes de tener el primer año de datos es
  resolver un problema que no existe.
- **La pantalla de consulta.** Primero que los datos se escriban. Mientras tanto
  se consulta con SQL, que es como se consulta hoy `compras_historial`.
- **La firma doble** (REG-CA-03, REG-IN-08 del documento funcional: dos personas
  para liberar un lote crítico o para un ajuste grande). Es otra decisión, del
  negocio y no del registro.

## Lo que falta de una persona

- Correr la migración, como siempre.
- Decidir si `admin_sistema` es el único que puede leer la auditoría o si el
  administrador de cada módulo ve la suya. Arranca cerrado, que es lo reversible.
