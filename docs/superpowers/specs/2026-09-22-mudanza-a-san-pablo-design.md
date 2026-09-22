# Mudar la app y la base a San Pablo

Acordado el 22 de septiembre de 2026. Es una mudanza de infraestructura: **no
cambia una línea de la lógica del sistema**, ni la autenticación, ni RLS, ni el
dominio. Cambian cuatro variables de entorno y la región de Vercel.

El pedido que lo originó era más amplio —"llevar todo a un mismo servidor, con
la base propia en vez de las planillas"—. La medición lo redujo a esto, y el
resto quedó como proyecto aparte (ver **Lo que este spec no hace**).

## El problema, medido

La queja era "el sistema anda lento": al navegar, en los listados grandes y en
las sincronizaciones. Antes de diseñar nada se midió de dónde sale esa lentitud.

### Dónde está cada pieza

| | RTT desde Buenos Aires |
|---|---|
| Orilla de Cloudflare (Buenos Aires) | **25 ms** |
| AWS `sa-east-1` (San Pablo) | **100 ms** |
| AWS `us-east-1` (Virginia) | **193 ms** |

Supabase responde con `x-envoy-upstream-service-time` de **3 a 21 ms** —lo que
tarda la base misma— y un TTFB total de ~290 ms. Los ~200 ms de diferencia son
el viaje de la orilla al origen, que coincide con `us-east-1` y no con
`sa-east-1`. **La base está en Virginia.** Vercel está en `iad1`, que es la
misma región.

### Qué significa eso

La base **no es lenta**: contesta en 3-21 ms. Y la app **no está lejos de la
base**: están en la misma región, así que las consultas del servidor cuestan
unos pocos milisegundos. La pantalla de Compras hace 8 `await`, y los ocho
juntos no llegan a 50 ms.

Lo que está lejos es **la gente**. Cada viaje del navegador a la app cuesta
**193 ms**, y el sistema hace muchos: 125 de las 227 pantallas son client
components y hay **260 llamadas `fetch()` a `/api` desde el navegador**. Una
pantalla que dispare cuatro paga ~800 ms de red pura antes de mostrar un dato.

Esa es toda la lentitud. No es la base, no es el volumen, no es Sheets.

### El tamaño real del sistema

| | |
|---|---|
| Tablas | 115 |
| Filas en las 15 tablas más grandes | ~43.000 |
| Usuarios | **11** |
| Buckets de Storage | 2 (`execution-photos`, `facturas-proveedor`) |

No hay ningún problema de escala. `calculos_diarios` es la tabla más grande con
16.317 filas. Eso entra holgado en cualquier hardware.

### Starlink no era el problema

La primera hipótesis fue que la conexión satelital del usuario agregaba
latencia. Es falsa: el `time_connect` a la orilla de Cloudflare es de **25 ms**,
que es muy bueno. Queda escrito porque es la clase de sospecha que vuelve.

## Lo que se decidió, y lo que se descartó

Se evaluaron tres caminos.

**A — Un servidor en la planta** (Supabase self-hosted en Docker). Era el pedido
original. Daría latencia de LAN (~1 ms) y, sobre todo, **seguiría andando con el
internet caído**, que es un problema real: la conexión de la planta "se corta a
veces" y casi todos los usuarios están ahí. Se descartó por el costo de operar
hardware —UPS, discos, restauraciones— aun teniendo un proveedor de IT
contratado.

**B — Quedarse en la nube, más cerca.** Es lo que se eligió.

**C — Bajar los viajes del navegador sin mover nada.** No se descartó: no compite
con B, se suma. Queda fuera de este spec.

### El riesgo que B acepta

**Cuando se corte el internet de la planta, el sistema queda inaccesible para
todos.** B no resuelve eso; sólo A lo resolvía. Se acepta a cambio de no operar
hardware. Queda escrito para que la próxima vez que se caiga el enlace nadie
busque la causa en el sistema.

### La trampa que hay que no pisar

> **Vercel y Supabase se mueven juntas o no se mueve ninguna.**

Hoy están las dos en Virginia y se consultan en ~5 ms. Si se moviera sólo Vercel
a San Pablo, cada uno de los 8 `await` de la pantalla de Compras pasaría a costar
193 ms: **+1,5 segundos por pantalla**. La mudanza sería un empeoramiento
grande, y del tipo que se descubre en producción.

## Lo que queda después

| | Hoy | Después |
|---|---|---|
| App | Vercel `iad1` (Virginia) | Vercel `gru1` (San Pablo) |
| Base | Supabase `us-east-1` | Supabase `sa-east-1` |
| Navegador ↔ app | **193 ms** | **~100 ms** |
| App ↔ base | ~5 ms | ~5 ms (siguen juntas) |
| Dominio | `sistema-integral-one.vercel.app` | **igual** |

Las 260 llamadas del navegador mejoran solas, sin tocar código. El dominio no
cambia, así que **los Apps Script de las planillas no se tocan**: siguen
apuntando al mismo `URL_APP`.

### Lo que se verificó contra la documentación

No se dio nada por sabido; esto se chequeó el 22/09/2026:

- **`gru1` existe y es `sa-east-1`** (San Pablo). Está en la lista de las 19
  regiones con cómputo.
- **Una sola región alcanza en cualquier plan.** Hobby permite una región —y
  puede ser cualquiera, no está clavada en `iad1`—; Pro permite hasta 5. **No
  hace falta cambiar de plan.**
- **Supabase no cambia de región en el lugar.** Hay que crear un proyecto nuevo
  y migrarle los datos. Es lo que este spec hace. (En planes pagos con backups
  físicos existe "Restore to another project", que puede simplificar el Paso 4;
  conviene mirar si está disponible antes de la ventana.)
- **El contenido estático ya se sirve desde el PoP de Buenos Aires.** Lo que se
  mueve es el cómputo. O sea que la mejora cae entera sobre las llamadas
  dinámicas —que son justamente las 260—, y no sobre el HTML y el JS, que ya
  venían cerca.

### San Pablo cuesta más caro

Vercel cobra distinto por región, y `gru1` está entre las caras:

| | `iad1` | `gru1` | |
|---|---|---|---|
| Fluid Active CPU | $0,128/h | $0,221/h | **1,7×** |
| Provisioned Memory | $0,0106/GB-h | $0,0183/GB-h | **1,7×** |
| Edge Requests | $2,00/M | $3,20/M | 1,6× |
| Fast Data Transfer | $0,15/GB | $0,22/GB | 1,5× |
| Fast Origin Transfer | $0,06/GB | $0,41/GB | **6,8×** |

Con 11 usuarios y 43.000 filas el volumen es chico, así que lo más probable es
que siga entrando en lo incluido del plan y la factura no se mueva. Pero las
tarifas son ésas: **conviene mirar la primera factura después de la mudanza** en
vez de suponer que no cambió. El que más salta es Fast Origin Transfer, que es
lo que la función se trae de afuera.

## Cómo se hace

### La herramienta de migración ya existe

`.github/workflows/backup.yml` produce cuatro dumps —esquema, datos, roles y
**auth**— todas las noches a las 03:00 ART. Eso es exactamente lo que hace falta
para poblar el proyecto nuevo.

**Se usa ese, no uno nuevo.** Un migrador escrito para la ocasión corre una sola
vez y nunca fue probado; este corre todas las noches desde hace meses. La
diferencia importa justamente en la operación que no se puede repetir.

### Paso 1 — Ensayo completo en un proyecto descartable

**No negociable, y va antes de fijar la fecha.**

Crear un proyecto Supabase en `sa-east-1`, restaurarle el dump de la última
noche y **entrar con un usuario real**. No alcanza con que la app levante.

El motivo está en `docs/BACKUPS.md`: el esquema `auth` —donde viven los
usuarios— no entra en el dump por defecto, va en un cuarto dump aparte, y ese
dump **"no es fatal si falla"**. O sea que hay un camino en el que el backup se
da por bueno, se restauran los 43.000 registros, y **nadie puede entrar al
sistema**. Si eso se descubre en la ventana real, la ventana se terminó.

El ensayo también mide cuánto tarda de verdad el restore, que es lo que fija el
largo de la ventana.

### Paso 2 — Los dos buckets de Storage

`execution-photos` (fotos de mantenimiento) y `facturas-proveedor` (PDF de
facturas) son **privados y no viajan en un dump de Postgres**. Hay que copiarlos
con un script aparte, con la service role key de los dos proyectos.

Es el agujero clásico de esta migración: la base queda perfecta, y las fotos y
las facturas apuntan a un bucket vacío. No se nota hasta que alguien abre una
orden de trabajo vieja.

### Paso 3 — La ventana

**22:00 a 02:00 ART, un día de semana.** Se eligió midiendo qué corre a cada
hora:

| Hora ART | Qué corre |
|---|---|
| cada 15 min | `compras-sync`, `inventario-sync`, `mantenimiento-sync` (GitHub Actions) |
| 19:00 | `remises-notificaciones` (Vercel) |
| 21:00 / 03:00 / 09:00 / 15:00 | `rrhh-recalculo` (GitHub Actions, cada 6 h) |
| 03:00 | `backup` (GitHub Actions) |
| 03:00 a 06:30 | los cinco syncs de Vercel |

Entre las 22:00 y las 02:00 no hay nada programado.

> **Pero no hay hora tranquila por sí sola.** Los tres workflows de 15 minutos
> corren siempre. Si no se apagan a mano, siguen leyendo las planillas y
> **escribiendo en la base vieja después del dump** — y esos datos se pierden en
> silencio, porque el workflow termina en verde. Apagarlos es parte de congelar,
> no un detalle operativo.

Congelar es entonces tres cosas: avisarle a la gente, apagar los tres workflows
de 15 minutos, y apagar los crons de `vercel.json`.

### Paso 4 — Dump, restore y verificación

En ese orden, y **la verificación va antes de apuntar nada**:

1. Dump de la base vieja, ya congelada.
2. Restore en el proyecto nuevo de `sa-east-1`.
3. **Contar las filas de las 115 tablas en los dos lados y comparar.** Una tabla
   que quedó en cero no se ve entrando a la app; se ve contando.
4. Copiar los dos buckets y verificar que un archivo conocido se abre.

### Paso 5 — Apuntar

Lo que cambia, y es todo lo que cambia:

| Dónde | Qué |
|---|---|
| Vercel | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Vercel | `DATABASE_URL` |
| `vercel.json` | `"regions": ["gru1"]` |
| GitHub Secrets | `SUPABASE_DB_URL` (el del backup, con el **session pooler** del proyecto nuevo) |

Las 24 variables `GOOGLE_SHEETS_*`, las de Odoo, las de push y las de Drive **no
se tocan**.

### Paso 6 — Ejercitar la operación final

Levantar la app no es verificar. Antes de reabrir hay que correr lo que va a
correr la gente:

- Entrar con un usuario real —no con la service role key—.
- Cargar algo y ver que quedó.
- Abrir una foto de mantenimiento vieja y una factura vieja (los buckets).
- Disparar **un** sync a mano y ver que escribe donde corresponde.
- Medir el TTFB de nuevo y comprobar que bajó. Si no bajó, algo quedó apuntando
  a Virginia.

Recién entonces se reencienden los tres workflows de 15 minutos y los crons.

## Cómo se vuelve atrás

Mientras el proyecto viejo siga en pie, volver son **las mismas cuatro variables
y la región**. Por eso el proyecto de `us-east-1` no se borra por varias
semanas, aunque se esté pagando al pedo.

La vuelta atrás tiene una asimetría que conviene saber: **lo que se cargó en el
proyecto nuevo no vuelve solo**. Si se decide volver dos días después, esos dos
días hay que traerlos a mano. Por eso la decisión de quedarse o volver conviene
tomarla el mismo día.

## Riesgos asumidos

**Las escrituras entre el dump y el apuntado se pierden.** Es la razón de la
ventana congelada, y la razón de apagar los workflows de 15 minutos. No hay
mitigación más allá de que la ventana sea corta.

**El esquema `auth` es la parte frágil.** Mitigado con el ensayo del Paso 1, que
es justamente para descubrirlo antes.

**La factura de Vercel puede subir.** Las tarifas de `gru1` son ~1,7× las de
`iad1`, y Fast Origin Transfer ~6,8×. Con este volumen no debería notarse, pero
no se midió el consumo actual: se asume y se verifica con la primera factura.

**El sistema sigue muriendo con el internet de la planta.** B no lo resuelve. Si
esto se vuelve intolerable, el camino es A y este spec no lo cierra: mudarse a
`sa-east-1` no dificulta un self-hosted posterior.

**No se sabe todavía cuánto baja de verdad.** La estimación es 193 ms → ~100 ms
por viaje, sacada de RTT medidos a `dynamodb.sa-east-1.amazonaws.com`. Vercel
`gru1` debería estar cerca de ahí, pero no se midió contra Vercel mismo. Si al
terminar el Paso 6 la mejora es marginal, la respuesta no es volver: es que el
cuello estaba en la cantidad de viajes y no en su largo, y eso lo arregla el
proyecto C.

## Lo que este spec no hace

**No toca Sheets.** El pedido original incluía que las planillas dejaran de ser
la fuente y quedaran como backup. Eso es un proyecto aparte, más grande y de
otra naturaleza: toca 171 archivos, 24 ids de planilla, 6 crons y los Apps
Script — pero sobre todo **cambia cómo trabaja la gente**. Se midió que los
pedidos de compra nuevos entran por un **Google Form**, no por el SdG: sacar la
planilla implica que esa gente cambie de herramienta. Se acordó que el Form
convive en paralelo un tiempo, sin fecha técnica.

**No baja las 260 llamadas del navegador** (el proyecto C). Después de esta
mudanza cada una cuesta ~100 ms en vez de 193 ms, pero cuatro llamadas siguen
siendo cuatro viajes. Ahí queda la mejora más grande que resta, y conviene
medirla pantalla por pantalla antes de tocarla.

**No cambia de proveedor.** Vercel y Supabase siguen siendo los mismos; cambia
en qué región corren.

## Pendiente de seguridad, no relacionado con la mudanza

Durante el relevamiento, un `grep` mal acotado volcó el contenido de
`GOOGLE_SERVICE_ACCOUNT_JSON` —incluida la clave privada de
`sheets-reader@mantenimientopp.iam.gserviceaccount.com`— en el transcript de la
sesión. La clave sigue siendo válida. Si ese transcript se exportó o compartió,
conviene **rotarla en Google Cloud** y actualizarla en Vercel, en `.env.local` y
en los secrets de GitHub. Queda anotado acá porque es el lugar donde se va a
mirar, aunque no tenga que ver con la mudanza.
