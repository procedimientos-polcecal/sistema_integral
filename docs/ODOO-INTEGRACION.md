# Odoo — Integración

Traer Contabilidad, Tesorería y las órdenes de compra del Odoo del grupo al SdG.
Acá está el terreno, la regla de quién manda en qué, y qué hay construido hoy.

## El terreno

`https://polcecal.odoo.com` → **Odoo 17.0 Enterprise, en Odoo Online (SaaS)**.
Se verifica sin credenciales, y conviene rehacerlo después de cada actualización
que Odoo aplique sola:

```bash
curl -s -X POST 'https://polcecal.odoo.com/jsonrpc' -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"call","params":{"service":"common","method":"version","args":[]},"id":1}'
```

Lo que eso implica:

- **JSON-RPC** (`/jsonrpc`, `execute_kw`). La API nueva con `Authorization:
  Bearer` (la JSON-2, `/json/2/<modelo>/<metodo>`) es de la 19: acá no existe.
  Si Odoo actualiza la base a 19, conviene migrar, pero JSON-RPC sigue andando.
- **API key**, no contraseña. La genera el usuario en su perfil de Odoo →
  Seguridad de la cuenta → API Keys.
- **Nada de módulos propios ni acceso al Postgres de Odoo**: es SaaS. Todo sale
  por los modelos estándar del ORM. Campos propios, si hacen falta, se agregan
  con Studio (viene con Enterprise).
- `db.list` está bloqueado desde afuera, así que el nombre de la base no se puede
  descubrir: se confirma autenticando. Es casi seguro `polcecal`.

## La regla: quién manda en qué

La consigna inicial era "bidireccional por módulo". Se cambió por **bidireccional
por dirección del dato**, y no por gusto: en contabilidad no existe una regla de
resolución de conflictos aceptable. "El último que escribe gana" sirve para un
pedido de compra, no para un libro contable. Y hay tres cosas duras de Odoo que
no se negocian desde afuera:

1. Un `account.move` **posteado es inmutable**: no se modifica ni se borra, se
   revierte. Un `write` sobre un asiento confirmado falla o deja basura.
2. La **numeración de comprobantes y las secuencias fiscales** las asigna Odoo al
   postear. El SdG no puede inventarlas.
3. Los **pagos y la conciliación** no son un `create`: van por wizards
   (`account.payment.register`) con lógica que no se puede saltear sin romper la
   conciliación.

| Dominio | Modelos | Dueño | Qué hace el SdG |
|---|---|---|---|
| **Compras** | `purchase.order`, `purchase.order.line` | El SdG | Crea la OC **en borrador** desde su circuito de aprobación; lee estado, recepción y facturación. Bidireccional real. |
| **Contabilidad** | `account.move`, `account.move.line`, `account.journal` | Odoo | Lee. Como máximo crea facturas de proveedor **en draft**, que un humano postea en Odoo. |
| **Tesorería** | `account.payment`, saldos por diario | Odoo | Lee saldos y pagos, para cruzarlos con Compras. |
| **Proveedores** | `res.partner` | Compartido | Lee y escribe libre: no es dato fiscal. Se cruza con `importarProveedores.ts`, que ya existe. |

En una línea: **el SdG propone, Odoo confirma.**

Escribir siempre por los métodos del ORM (`button_confirm`, `action_post`, el
wizard de pagos), nunca con un `write` directo sobre el estado. El `write`
directo es precisamente lo que saltea las reglas que hacen que la contabilidad
cierre.

## Las dos empresas

POLCECAL y POLYSAN conviven en los módulos del SdG. **Odoo las lleva por
separado**: toda orden de compra, todo asiento, todo diario y todo pago
pertenece a una `res.company` y sólo a una. No está mal —son dos patrimonios
distintos— pero cambia dos cosas de la integración.

### 1. La falla que no se ve

Si el usuario bot tiene una sola empresa habilitada, Odoo **filtra en silencio**:
las lecturas devuelven la mitad del grupo, con HTTP 200 y sin una advertencia. Un
`limit` que no alcanza se nota; esto no.

Por eso el cliente resuelve las empresas del usuario al iniciar sesión
(`res.users.company_ids`) y manda `allowed_company_ids` en el contexto de **todas**
las llamadas, en vez de dejar que Odoo aplique la empresa por defecto. Si el bot
ve menos de dos, el ping lo levanta como alerta.

Corolarios:

- Toda lectura de un modelo con empresa pide `company_id` entre los campos, y
  todo conteo se hace por empresa (`contarPorEmpresa`). Un total del grupo no
  distingue entre "las dos tienen datos" y "sólo veo una".
- Un saldo de tesorería sumado de las dos empresas no significa nada.
- Al **crear** en Odoo, la empresa va en los valores *y* en el contexto
  (`crearEn`). No es redundante: Odoo saca el diario, la secuencia y la posición
  fiscal de la empresa del **contexto**, así que con sólo uno de los dos el
  registro queda en una empresa con la numeración de la otra.
- El mapeo vive en la base: `empresas.odoo_company_id` (migración 045), no como
  constante en el código. Se llena después de correr el ping.

### 2. "AMBAS" no existe en Odoo

Compras tiene cuatro estados de empresa (`lib/compras/types.ts`): POLCECAL,
POLYSAN, **AMBAS** (`empresa_id` null + `paga_ambas` true) y sin definir. Odoo
tiene dos. Un requerimiento que pagan las dos no tiene un `purchase.order` que lo
represente.

**Decidido (31/08/2026): dos órdenes, una por empresa.**

El motivo es de hecho, no de diseño: en un RI compartido **el proveedor factura a
las dos empresas por separado**, un comprobante por CUIT. Cualquier solución de un
solo documento —por ejemplo una OC con `analytic_distribution`, que reparte el
gasto en porcentajes sin duplicar la orden— contradiría eso: la factura sería de
una sola empresa y la otra no tendría comprobante. El reparto analítico queda
descartado por eso, no por limitación técnica.

Lo que arrastra la decisión:

- **Un RI del SdG pasa a tener N documentos en Odoo** (hoy N=2). El mapeo no puede
  ser una columna `odoo_id` en `compras_requerimientos`: necesita una tabla
  aparte, con clave `(requerimiento_id, empresa_id) → odoo_order_id`.
- **El estado de "la" compra deja de ser uno.** Una OC puede estar confirmada y la
  otra en borrador, o una facturada y la otra no. La pantalla de Compras tiene que
  poder mostrar dos estados para un RI, o decidir una regla de agregación
  explícita (el menos avanzado de los dos, por ejemplo).
- **Hay que definir cómo se parte el monto.** Es lo único que falta para poder
  escribir el push: 50/50, por líneas, o a mano al aprobar. Debería quedar como
  dato en el RI (un porcentaje), no como constante en el código.
- **La idempotencia se complica**: reintentar un push tiene que ser capaz de
  encontrar la orden ya creada de *cada* empresa, no una sola. Sin eso, un
  reintento duplica en Odoo, que es el peor de los errores posibles ahí.

Hasta que esté definido el reparto, la sincronización de Compras sólo puede
empujar los requerimientos con **una** empresa definida.

## Qué hay hoy (spike)

**`lib/odoo/client.ts`** — cliente JSON-RPC con `fetch` a mano, sin dependencias
nuevas, igual que `lib/core/google.ts`.

- `iniciarSesion()` resuelve el `uid` **y las empresas habilitadas**, y lo cachea
  mientras viva la instancia; `olvidarSesionOdoo()` lo tira (hace falta al rotar
  la API key).
- `llamar(modelo, metodo, args, kwargs)` es la base; `buscarLeer`, `contar`,
  `agrupar` (`read_group`) y `camposDe` (`fields_get`) son azúcar encima.
- Para las dos empresas: `empresasDeOdoo()`, `contarPorEmpresa()`, `crearEn()` y
  la opción `empresa` de `buscarLeer` (ver "Las dos empresas" más arriba).
- Todas las llamadas van con contexto `es_AR` + tz `America/Argentina/Buenos_Aires`.
  La tz no es cosmética: Odoo guarda los `datetime` en UTC, y sin eso agrupar
  "por día" corre los registros de la noche al día siguiente.
- `mensajeDeOdoo()` traduce la excepción de Python a algo accionable, y manda el
  traceback al log del servidor en vez de a la pantalla.
- Dos trampas de JSON-RPC que el cliente ya cubre: **los errores vienen con HTTP
  200** y el detalle adentro del cuerpo; y **una credencial mala no es un error**,
  `authenticate` devuelve `false` y sigue de largo.

**`app/api/odoo/ping/route.ts`** — diagnóstico. `GET /api/odoo/ping`, sólo admin.
No escribe nada en Odoo. Cada sonda va en su propio `try`, así que un permiso
faltante no tapa las diez respuestas siguientes: el valor del endpoint es
justamente el mapa de qué anda y qué no.

Sondea: usuario de integración **y qué empresas ve**, empresas de Odoo con sus
ids (que son los que van a `empresas.odoo_company_id`), órdenes de compra,
proveedores —separando los compartidos de los exclusivos de una empresa—,
diarios de tesorería, facturas de proveedor, pagos, saldos por empresa y
diario vía `read_group`, y los campos reales de `purchase.order` (para ver si la
base tiene campos propios `x_` o de localización `l10n_`).

**`lib/odoo/client.test.ts`** — 28 tests con `fetch` mockeado: no salen a la red.

**`supabase/migrations/045_empresas_mapeo_odoo.sql`** — `empresas.odoo_company_id`,
el mapeo de las dos empresas con las de Odoo. Queda NULL hasta correr el ping.

## Cómo probarlo

1. En Odoo: elegir o crear el usuario de integración y generar su API key
   (perfil → Seguridad de la cuenta → API Keys). Ojo que en Enterprise un usuario
   interno nuevo puede consumir licencia; usar uno existente funciona igual, pero
   se pierde trazabilidad de quién escribió.
2. Cargar `ODOO_URL`, `ODOO_DB`, `ODOO_USER` y `ODOO_API_KEY` en `.env.local`
   (están documentadas en `.env.example`).
3. `npm run dev`, entrar como admin y abrir `/api/odoo/ping`.

Leer el `resumen`: `revisarPermisosDe` lista los modelos que rechazaron la
lectura, que es lo mismo que decir qué grupos hay que darle al usuario bot en
Odoo (Ajustes → Usuarios). Como mínimo va a necesitar Compras y algo de
Contabilidad; qué exactamente lo dice el ping, no la adivinanza.

## Próximos pasos

1. **Correr el ping** y cerrar los permisos del usuario bot.
2. **Llenar `empresas.odoo_company_id`** con los ids que devuelva el ping (migración 045).
3. **Definir el reparto de las AMBAS** (ver arriba): ya se sabe que van dos OCs, falta
   con qué porcentaje se parte cada una. Bloquea el push de Compras.
4. **Mapeo de ids**, para que la sync sea idempotente y no duplique:
   `odoo_write_date` en las tablas que se sincronizan, y para Compras una tabla de
   vínculo `(requerimiento_id, empresa_id) → odoo_order_id`, porque un RI
   compartido son dos órdenes. Del lado de Odoo, un campo `x_sdg_id` con Studio
   para el camino inverso.
5. **Pull incremental** por cron: filtrar `[["write_date", ">", ultimo_sync]]` y
   traer sólo el delta. Reusar `lib/core/cron.ts` y `lib/core/sincronizaciones.ts`,
   que ya llevan el registro de las corridas.
6. **Push de Compras**: crear la OC en draft al aprobarse en el SdG, con `crearEn`.
7. **Webhook** para lo urgente: Odoo 17 tiene la acción "Send Webhook
   Notification" en las reglas de automatización, con log de llamadas. Mismo
   patrón que el Apps Script de la planilla, protegido con un secreto propio.

## Cuidados

- **Throttling de Odoo Online**: siempre `fields` explícitos y `limit`. Sin
  `fields`, Odoo devuelve los 200+ campos de `account.move`.
- **Las dos empresas**: tiene su sección arriba, y es el cuidado principal. En
  resumen: `allowed_company_ids` en toda llamada, `company_id` en toda lectura,
  y nunca sumar las dos empresas en un mismo número.
- **Localización argentina**: hay facturación electrónica de por medio. Es la
  razón de fondo por la que el SdG no postea comprobantes.
- **Actualizaciones de Odoo Online**: las aplica Odoo, no nosotros. Cuando pase a
  18 o 19 hay que rehacer el `curl` de arriba y revisar los nombres de campo.
