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

## Qué hay hoy (spike)

**`lib/odoo/client.ts`** — cliente JSON-RPC con `fetch` a mano, sin dependencias
nuevas, igual que `lib/core/google.ts`.

- `autenticar()` cachea el `uid` mientras viva la instancia; `olvidarSesionOdoo()`
  lo tira (hace falta al rotar la API key).
- `llamar(modelo, metodo, args, kwargs)` es la base; `buscarLeer`, `contar`,
  `agrupar` (`read_group`) y `camposDe` (`fields_get`) son azúcar encima.
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

Sondea: usuario de integración, empresas visibles, órdenes de compra,
proveedores, diarios de tesorería, facturas de proveedor, pagos, saldos por
diario vía `read_group`, y los campos reales de `purchase.order` (para ver si la
base tiene campos propios `x_` o de localización `l10n_`).

**`lib/odoo/client.test.ts`** — 21 tests con `fetch` mockeado: no salen a la red.

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
2. **Mapeo de ids**: columna `odoo_id` (+ `odoo_write_date`) en las tablas que se
   sincronizan, para que la sync sea idempotente y no duplique. Del lado de Odoo,
   un campo `x_sdg_id` con Studio para el camino inverso.
3. **Pull incremental** por cron: filtrar `[["write_date", ">", ultimo_sync]]` y
   traer sólo el delta. Reusar `lib/core/cron.ts` y `lib/core/sincronizaciones.ts`,
   que ya llevan el registro de las corridas.
4. **Push de Compras**: crear la OC en draft al aprobarse en el SdG.
5. **Webhook** para lo urgente: Odoo 17 tiene la acción "Send Webhook
   Notification" en las reglas de automatización, con log de llamadas. Mismo
   patrón que el Apps Script de la planilla, protegido con un secreto propio.

## Cuidados

- **Throttling de Odoo Online**: siempre `fields` explícitos y `limit`. Sin
  `fields`, Odoo devuelve los 200+ campos de `account.move`.
- **Multi-empresa**: la URL del usuario mostraba `cids=1`, o sea una sola empresa
  activa. Si mañana hay más, las lecturas necesitan `allowed_company_ids` en el
  contexto, o devuelven sólo lo de la empresa por defecto del usuario bot.
- **Localización argentina**: hay facturación electrónica de por medio. Es la
  razón de fondo por la que el SdG no postea comprobantes.
- **Actualizaciones de Odoo Online**: las aplica Odoo, no nosotros. Cuando pase a
  18 o 19 hay que rehacer el `curl` de arriba y revisar los nombres de campo.
