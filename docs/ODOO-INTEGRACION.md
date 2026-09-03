# Odoo — Integración

Traer Contabilidad, Tesorería y las órdenes de compra del Odoo del grupo al SdG.
Acá está el terreno, la regla de quién manda en qué, y qué hay construido hoy.

## El terreno

`https://polcecal.odoo.com` → **Odoo 17.0 Enterprise, en Odoo.sh**. La versión se
verifica sin credenciales, y conviene rehacerlo después de cada actualización:

```bash
curl -s -X POST 'https://polcecal.odoo.com/jsonrpc' -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"call","params":{"service":"common","method":"version","args":[]},"id":1}'
```

Que sea **Odoo.sh y no Odoo Online** se descubrió por el nombre de la base:
`blueorangegroup-polcecal-main-16308531`, que es el patrón
`<proyecto>-<rama>-<build>` de Odoo.sh. El proyecto está a nombre de un partner
("blueorangegroup"), o sea que hay un tercero administrando la instancia.

Lo que eso implica:

- **JSON-RPC** (`/jsonrpc`, `execute_kw`). La API nueva con `Authorization:
  Bearer` (la JSON-2, `/json/2/<modelo>/<metodo>`) es de la 19: acá no existe.
  Si la base se actualiza a 19, conviene migrar, pero JSON-RPC sigue andando.
- **API key**, no contraseña. La genera el usuario en su perfil de Odoo →
  Seguridad de la cuenta → API Keys.
- **El nombre de la base lleva el id del build**, así que un redeploy puede
  cambiarlo y dejar la integración hablándole a una base que ya no está. El error
  que devuelve Odoo en ese caso lo contesta PostgreSQL y habla de psycopg2 y de
  un pool de conexiones; `mensajeDeOdoo()` lo traduce a "revisá ODOO_DB". Si un
  día la sincronización empieza a fallar entera y de golpe, esto es lo primero a
  mirar.
- **Módulos propios: técnicamente sí, en la práctica no solos.** Odoo.sh permite
  código propio, pero se despliega desde el repositorio del proyecto, que es del
  partner. Todo lo que hagamos sale por los modelos estándar del ORM; los campos
  extra se agregan con Studio (Enterprise lo incluye), como ya hizo alguien: hay
  un `x_studio_...` en `purchase.order`.
- **Sin acceso al Postgres de Odoo** y `db.list` bloqueado desde afuera.

### Cómo se averigua el nombre de la base

El host resuelve la base solo —una petición sin base válida llega igual a la capa
de datos y contesta "Session Expired"—, pero JSON-RPC exige el nombre explícito en
cada llamada, y no hay forma de leerlo desde afuera: se probaron `/web/health`,
`/website/info`, el `session_info` de la página de login y el manifest del PWA.
Ninguno lo trae.

Sale de la sesión del navegador. Logueado en Odoo, en la consola (F12):

```js
fetch('/web/session/get_session_info',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"jsonrpc":"2.0","method":"call","params":{}}'}).then(r=>r.json()).then(d=>console.log('LA BASE ES:', d.result && d.result.db))
```

Este anda desde cualquier página del dominio. `odoo.__session_info__.db`, que es
lo primero que uno prueba, **no sirve en las páginas públicas**: ahí el objeto no
trae `db` y a veces no existe. Y Chrome no deja pegar en la consola hasta que se
escriba a mano `allow pasting`.

En Odoo.sh el nombre también está en el build de producción del proyecto
(https://www.odoo.sh/project), que es donde lo vería el partner.

Para **verificar** un candidato, el que sirve es `authenticate`, no `db_exist`.

`db_exist` parece la herramienta obvia y no lo es: en esta instancia `db.list`
está bloqueado (`list_db` apagado) y en ese estado `db_exist` contesta `false`
para cualquier nombre, incluido el correcto. Diez nombres dieron `false` sin que
eso probara nada.

`authenticate` en cambio distingue tres estados, y el primero lo contesta
PostgreSQL, así que no se puede confundir:

| Respuesta | Qué significa |
|---|---|
| `database "X" does not exist` | La base no es ésa |
| `"result": false` | **La base existe**, las credenciales están mal |
| `"result": <número>` | Base y credenciales bien; ese número es el `uid` |

```bash
curl -s -X POST 'https://polcecal.odoo.com/jsonrpc' -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"call","params":{"service":"common","method":"authenticate","args":["NOMBRE","EMAIL","API_KEY",{}]},"id":1}'
```

Y no: **el nombre no se puede adivinar**. Se probaron diez variantes razonables
del nombre de la empresa antes de encontrar que el real lleva el nombre del
partner y el id del build.

## Lo que dijo el diagnóstico (03/09/2026)

Corrió entero contra la base real. **Las once sondas pasaron**: el usuario bot
(uid 17) lee compras, proveedores, contabilidad y tesorería de las dos empresas
sin que falte un permiso.

| Empresa de Odoo | id | Órdenes de compra | Facturas de proveedor | Pagos |
|---|---|---|---|---|
| Polcecal S.A | **1** | 2.133 | 3.780 | 3.470 |
| Polysan S.A | **2** | 162 | 2.488 | 2.767 |
| | | 2.295 | 6.268 | 6.237 |

Las dos operan en ARS. Los ids 1 y 2 son los que van a `empresas.odoo_company_id`.

Dos cosas que no se sabían y cambian el diseño:

**1. Compras está muy desbalanceado.** Polcecal tiene 2.133 órdenes y Polysan
162, pero en facturas de proveedor están casi a la par (3.780 y 2.488). O sea que
en Polysan se factura sin pasar por una orden de compra. Antes de sincronizar
conviene entender por qué, porque el módulo Compras del SdG asume que el
requerimiento precede a la compra.

**2. El padrón de proveedores está duplicado por empresa.** De 610 registros de
proveedor hay sólo **422 CUITs distintos**, y **147 CUITs existen en las dos
empresas** —el mismo proveedor, dos registros, mismo nombre—. Además 111
registros no tienen empresa (compartidos) y 24 no tienen CUIT.

Eso significa que `proveedores` del SdG mapea a **1 o 2 partners de Odoo**, igual
que un RI compartido mapea a dos órdenes: mismo patrón, misma solución (tabla de
vínculo por empresa). Y el cruce tiene que ser **por CUIT (`vat`), no por
nombre**: el nombre está escrito igual en los duplicados, pero eso es suerte, no
garantía. Los 24 sin CUIT hay que enlazarlos a mano o dejarlos sin enlazar —
nunca "al que se le parece" (README de migraciones, trampa nº4).

Del resto de las sondas: 16 diarios de tesorería, 8 por empresa (Provincia,
Credicoop, BBVA, Efectivo, Cheques propios, Cheques de terceros, Retenciones,
Cobros y pagos), cada uno con su cuenta contable propia. `purchase.order` tiene
80 campos, uno agregado con Studio (`x_studio_related_field_1go_1j4st60r9`) y
ninguno de localización. `purchase.order.line` **sí** tiene
`analytic_distribution`: la vía analítica para las AMBAS existía técnicamente, y
se descartó por el hecho de la doble factura, no por límite de Odoo.

Los saldos de tesorería salen bien y no se anotan acá: cambian todos los días.

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
distintos— pero cambia tres cosas de la integración.

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
- **El reparto es 50/50** (decidido el 31/08/2026). Vive en
  `lib/compras/repartoAmbas.ts`, con el porcentaje en una constante para que
  cambiarlo sea una línea. El cálculo va en centavos: redondear las dos mitades
  por separado hace que $100,01 se convierta en dos órdenes que suman $100,02, y
  ese centavo es una hora de alguien buscándolo.
- **La idempotencia se complica**: reintentar un push tiene que ser capaz de
  encontrar la orden ya creada de *cada* empresa, no una sola. Sin eso, un
  reintento duplica en Odoo, que es el peor de los errores posibles ahí.

### 3. El 50/50 y las cantidades enteras no se pueden cumplir juntos

Esto sale del 50/50 y **no tiene una salida limpia**, así que conviene tenerlo a
la vista antes de escribir el push.

En Odoo el importe de una línea no se pone: sale de `cantidad × precio unitario`.
Entonces, para un RI de 3 unidades a $1.000:

| Cómo se parte | Empresa A | Empresa B | Problema |
|---|---|---|---|
| Por importe (50/50) | 1,5 u — $1.500 | 1,5 u — $1.500 | Nadie recibe media unidad |
| Por cantidad (2 y 1) | 2 u — $2.000 | 1 u — $1.000 | El reparto real es 67/33, no 50/50 |

`repartoAmbas.ts` privilegia el importe, que es lo acordado, y expone
`cantidadQuedaFraccionada()` para poder avisarlo en pantalla antes de mandar nada.

El caso peor es **cantidad = 1** —una bomba, un repuesto—, que en compras de
Mantenimiento es lo más común: media unidad para cada empresa no existe, y con
cantidades enteras el reparto sería 100/0. Un RI así, en rigor, o lo compra una
empresa y después se refactura, o no es un RI compartido.

**Pendiente de definición**, pero no bloquea: el push puede arrancar avisando y
dejando esos RI para revisión manual.

## El cruce de proveedores

Es el cimiento del resto: una orden de compra en Odoo necesita un `partner_id`.

**Va por CUIT normalizado, nunca por nombre.** Los dos padrones escriben el CUIT
distinto —Odoo sin guiones (`30708699574`), el SdG con guiones
(`20-36215654-9`)—, así que un cruce literal devuelve **cero coincidencias y
ningún error**. Y el nombre no sirve: en Odoo está la razón social y en el SdG el
nombre de fantasía.

| En el SdG | En Odoo | Mismo CUIT |
|---|---|---|
| Casa Camino | PEDRO H. CAMINO S.R.L. | 30710976356 |
| Distribuidora Pueyrredon | GIACOMASSO MIGUEL ANGEL | 20241639887 |

Por nombre no se habrían encontrado nunca. Peor: se habrían encontrado otros, y
un enlace equivocado no se nota — la orden de compra simplemente sale a nombre de
otro proveedor.

El ensayo con los datos del 03/09/2026 (287 proveedores en el SdG, 610 registros
en Odoo):

| | |
|---|---|
| **Enlazan** | **122** (76 de ellos a las dos empresas) |
| Sin CUIT en el SdG | 143 — no se pueden cruzar |
| Con CUIT que no está en Odoo | 15 |
| CUIT repetido en el padrón del SdG | 3 CUITs, 7 proveedores |
| CUITs de Odoo que el SdG no tiene | 298 |

Cuatro cosas que salen de ahí:

- **Los 143 sin CUIT quedan sin enlazar, y así se informan.** No se resuelven por
  nombre parecido (README de migraciones, trampa nº4). El camino barato para
  arreglarlos es el inverso: traerles el CUIT desde Odoo.
- **Ninguno de los 145 CUITs del SdG tiene el dígito verificador mal.** El padrón
  está mejor cargado de lo que uno esperaría de 145 CUITs tipeados a mano.
- **Los 3 CUITs repetidos son datos a corregir en el SdG**, no un problema de
  Odoo: hay tres Priola (David, Gustavo, Marcelo) con un solo CUIT, y dos casos
  de nombre de fantasía + nombre de la persona cargados como proveedores
  distintos. No se enlazan hasta que se decida cuál es cuál.
- **Odoo tiene 298 CUITs que el SdG no tiene.** El padrón de Odoo es bastante más
  grande, así que traer proveedores desde Odoo es una oportunidad concreta.

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

**`lib/odoo/proveedores.ts`** — el cruce por CUIT (`normalizarCuit`,
`cuitEsValido`, `cruzarProveedores`), función pura y con 15 tests. Devuelve los
enlaces y, con el mismo peso, los que **no** enlazan y por qué motivo: sin CUIT,
CUIT inválido, o no está en Odoo. Cada motivo se arregla en un lugar distinto.

**`app/api/odoo/proveedores/preview/route.ts`** — `GET`, sólo admin. Ensaya el
cruce contra los datos reales y **no escribe nada**, ni en Odoo ni en Supabase.
Está antes de la escritura a propósito: con el 51% del padrón sin CUIT, la
decisión de qué se enlaza y qué no tiene que ser visible antes de ejecutarse.

**`lib/compras/repartoAmbas.ts`** — el 50/50, con 16 tests. Es la única parte de
todo esto que se puede testear sin red, y la que más caro sale si está mal.

**`lib/odoo/client.test.ts`** — 28 tests con `fetch` mockeado: no salen a la red.

**Migraciones** — `045_empresas_mapeo_odoo.sql` creó
`empresas.odoo_company_id` y `20260903082202_empresas_el_mapeo_con_odoo.sql` lo
llenó (POLCECAL→1, POLYSAN→2). `20260903091434_proveedores_el_vinculo_con_odoo_por_empresa.sql`
crea `proveedores_odoo`, la tabla de enlace: una fila **por empresa**, porque un
proveedor del SdG es hasta dos partners de Odoo.

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

1. ~~Correr el ping~~ **hecho**: las once sondas pasan, los permisos del usuario
   bot están completos.
2. **Aplicar `20260903082202_empresas_el_mapeo_con_odoo.sql`** en el editor SQL de
   Supabase: llena `odoo_company_id` con 1 y 2. Hasta que se corra, las dos
   empresas están en null y nada puede mapearse.
3. **Entender el desbalance de Compras** (2.133 órdenes en Polcecal contra 162 en
   Polysan, con las facturas casi a la par). Es una pregunta para administración,
   no para el código, y conviene contestarla antes de sincronizar.
4. ~~Tabla de vínculo de proveedores~~ **hecha** (`proveedores_odoo`), falta
   **aplicar la migración** y después escribir los 122 enlaces que el preview ya
   calcula. Queda pendiente la de Compras:
   `(requerimiento_id, empresa_id) → odoo_order_id`, porque un RI compartido son
   dos órdenes. Del lado de Odoo, un campo `x_sdg_id` con Studio para el camino
   inverso.
5. **Definir qué se hace con los RI compartidos de cantidad impar** (ver arriba).
   No bloquea: el push puede avisar y dejarlos para revisión manual.
6. **Pull incremental** por cron: filtrar `[["write_date", ">", ultimo_sync]]` y
   traer sólo el delta. Reusar `lib/core/cron.ts` y `lib/core/sincronizaciones.ts`,
   que ya llevan el registro de las corridas.
7. **Push de Compras**: crear la OC en draft al aprobarse en el SdG, con `crearEn`.
   Para un RI compartido, dos órdenes, con el reparto de `repartoAmbas.ts`.
8. **Webhook** para lo urgente: Odoo 17 tiene la acción "Send Webhook
   Notification" en las reglas de automatización, con log de llamadas. Mismo
   patrón que el Apps Script de la planilla, protegido con un secreto propio.

## Cuidados

- **Throttling**: siempre `fields` explícitos y `limit`. Sin `fields`, Odoo
  devuelve los 200+ campos de `account.move`.
- **El saldo de un diario no se saca del diario.** Sumar todos los apuntes de un
  `account.journal` da **cero**: el asiento incluye su contrapartida, así que la
  suma es cero por partida doble. El saldo son los apuntes de la **cuenta** del
  diario (`default_account_id`). Se pisó: la primera versión de la sonda devolvió
  0,00 en los 16 diarios, con permisos correctos y sin ningún error. Es el tipo de
  número equivocado que nadie cuestiona porque la llamada "funcionó".
- **El nombre de la base puede cambiar en un redeploy** (lleva el id del build de
  Odoo.sh). Ver "El terreno".
- **Las dos empresas**: tiene su sección arriba, y es el cuidado principal. En
  resumen: `allowed_company_ids` en toda llamada, `company_id` en toda lectura,
  y nunca sumar las dos empresas en un mismo número.
- **Localización argentina**: hay facturación electrónica de por medio. Es la
  razón de fondo por la que el SdG no postea comprobantes.
- **Actualizaciones de Odoo Online**: las aplica Odoo, no nosotros. Cuando pase a
  18 o 19 hay que rehacer el `curl` de arriba y revisar los nombres de campo.
