# Las APIs del SdG

Qué función cumplen, con qué están conectadas y cómo funcionan.

**Esto se escribe a mano. El inventario no**: la lista de las 285 rutas —con sus
métodos, su guarda, sus tablas y de qué módulos de `lib/` depende cada una—
vive en [API-MAPA.generado.md](API-MAPA.generado.md) y la escribe
`npm run mapa-de-apis`. El corte entre los dos documentos es **quién puede
saberlo**: lo que sale del código va allá, lo que hay que haber vivido va acá.

Esa división no es prolijidad. Una lista de 285 rutas escrita a mano queda
desactualizada la semana que viene, y entonces pasa lo peor: alguien la lee y
le cree. Lo que no puede generarse —para qué sirve un módulo, por qué una ruta
escribe primero en la planilla— no envejece igual, porque son decisiones y no
inventario.

Lo que **no** está acá: el porqué de cada decisión, que vive en
[CLAUDE.md](../CLAUDE.md) y en `docs/superpowers/specs/`. Acá se los nombra y se
enlaza, no se los repite.

---

## 1. Cómo está hecha una ruta

Todas son Route Handlers de Next (`app/api/**/route.ts`), y casi todas hacen
las mismas siete cosas en el mismo orden. Conocer ese orden es la mitad de
poder leer cualquiera de las 285.

1. **Pedir la sesión.** `createClient()` de `lib/supabase/server` y
   `auth.getUser()`. Sin usuario, 401. (O `usuarioActual()` de
   `lib/core/sesion`, que es lo mismo memoizado por render.)
2. **Pedir el permiso del módulo**, cuando la ruta pertenece a uno:
   `puedeEditarMantenimiento`, `nivelEnModulo`, `puedeAprobarCompras`,
   `es_admin_check`. Sin nivel, 403.
3. **Leer el cuerpo**, con `cuerpoJson()` o `request.json()`.
4. **Validarlo.** Con zod a través de `validar()` cuando no hay validación
   propia; **las rutas que ya validan a mano no se tocan**, porque sus mensajes
   —«Contá qué pasa», «Falta quién lo pidió»— son mejores que cualquier cosa
   genérica.
5. **Hablar con la base.** Con el cliente de la sesión, que pasa por RLS, o con
   `createAdminClient()`, que **no pasa por RLS** — ver abajo.
6. **Exportar a la planilla**, si el módulo espeja una, y anotar el pendiente si
   no se pudo.
7. **Auditar**, si lo que acaba de hacer no se deshace.

Los pasos 5, 6 y 7 son los que tienen trampa, y cada uno tiene su regla en
[CLAUDE.md](../CLAUDE.md).

### El cliente admin es una decisión de permisos

**108 de las 285 rutas usan `createAdminClient()`.** Ese cliente usa la service
role key: **RLS no corre**. Lo que decide quién ve qué deja de ser la base y
pasa a ser la ruta.

No está mal —hay motivos buenos: leer `usuarios`, cuya policy es
`id = auth.uid() or es_admin()`, para traer la fila propia; escribir una tabla
que no tiene policy de insert— pero **cambia dónde hay que mirar** cuando uno
se pregunta si alguien puede ver algo. Con el cliente de la sesión, la
respuesta está en la policy; con el admin, está en el código de la ruta.

En el mapa esas rutas llevan la marca `admin`.

### Paginado: PostgREST corta en 1000 y no avisa

`.limit(3000)` devuelve 1000 filas sin error. Las rutas que previeron eso usan
`traerTodo()` de `lib/core/paginado` y en el mapa llevan la marca `paginado`.

---

## 2. Qué protege a cada ruta

Seis respuestas posibles, y la que más rutas tiene **no está escrita en el
archivo de la ruta**:

| | Rutas | Qué pide |
|---|---|---|
| permiso de módulo | 134 | sesión **y** nivel en el módulo |
| sesión | 70 | estar logueado, nada más |
| **el proxy** | 56 | el archivo no valida nada, y no hace falta |
| secreto del cron | 18 | `CRON_SECRET`, lo llama una máquina |
| secreto propio | 3 | un webhook con su variable de entorno |
| token contra la base | 1 | el `X-Goog-Channel-Token` de la Agenda |

**Las 56 del proxy son el punto que más confunde.** `proxy.ts` matchea todo lo
que no sea un asset estático, y `lib/supabase/middleware.ts` redirige al login
cualquier pedido sin sesión. O sea que **una ruta que no valida nada igual pide
sesión**: la pide el proxy. El docstring de `usuarioActual()` lo dice con todas
las letras — «es la que protege a las rutas que no validan por su cuenta».

Las únicas que el proxy deja pasar sin sesión están listadas una por una en ese
archivo, a propósito:

- todo `/api/cron/`
- `/api/compras/sheets/webhook`
- `/api/mantenimiento/sheets/webhook`
- `/api/facturacion/correo/webhook`
- `/api/agenda/google`

Las cinco validan lo suyo. **Hoy no hay ninguna ruta que esté exenta del proxy
y además no valide nada**; el generador lo comprueba en cada corrida y sale 1
si aparece una. Esa comprobación es el motivo de que el inventario se genere:
cruzar las dos listas no se puede hacer leyendo un archivo.

### La trampa del 307

El proxy **redirige**, no devuelve 401. Un `fetch` sigue el redirect por
defecto, así que un POST sin sesión termina con el **HTML del login y un 200**.
Eso ya costó una pérdida de datos: la pantalla de carga sin señal daba por
cargado lo que nunca entró, hasta que se cerró mirando que la respuesta
trajera el número. Si escribís un cliente que llame a estas rutas, un 200 no
alcanza como prueba de que algo salió bien.

---

## 3. Las cuatro familias

### Rutas de pantalla

La mayoría. Las llama el navegador de alguien logueado, con su sesión en la
cookie. Leen o escriben lo suyo y contestan JSON.

### Rutas de sincronización

Traen una planilla de Google al sistema. Las llama un cron **y también un botón**
en la pantalla del módulo, y por eso no pueden depender del secreto: validan
sesión y permiso como cualquier otra.

Son el corazón de cinco módulos y están explicadas en la sección «Las planillas
de Google» de [CLAUDE.md](../CLAUDE.md). Lo que hay que saber para leer una:
**lo que la planilla deja de tener, se borra** —con un freno de 50 filas o el
10 %— y el registro de auditoría se escribe **antes** del borrado.

### Rutas de cron

18, todas bajo `/api/cron/`. No las llama una persona: validan `CRON_SECRET`
con `revisarElSecreto()`, que **falla cerrado** —sin la variable configurada
devuelve 503 en vez de quedar abierto—.

**Y acá hay algo que conviene saber antes de tocar un cron: hay dos relojes.**

| | Cuántos | Cuáles |
|---|---|---|
| Sólo Vercel (`vercel.json`) | 7 | agenda, avisos-diarios, calidad-sync, produccion-molinos-sync, remises-notificaciones, rrhh-lenox-sync, syh-respaldo-de-fotos |
| Sólo GitHub Actions | 5 | calidad-envases-bajada, calidad-envases-sync, respaldo-sheets, rrhh-recalculo, taller-vial-partes-sync |
| **Los dos a la vez** | 6 | cantera-acarreo-sync, compras-sync, facturacion-sync, inventario-sync, mantenimiento-sync, taller-vial-sync |

Las seis de la última fila **se disparan desde dos lados**. Las
sincronizaciones son idempotentes, así que correr de más no rompe nada, pero
el número de veces que corre una no sale de un solo archivo — y buscarlo en
`vercel.json` solo da una respuesta incompleta.

Y una medida que ya está anotada: **los crons de Actions no corren cuando
dicen.** Declaran cada 15 minutos y en los hechos corren cada 3 a 5 horas;
GitHub no garantiza la puntualidad de `schedule`. Para algo que tiene que pasar
a una hora, el reloj de Vercel es el que cumple.

### Webhooks

Cuatro, y son los únicos que llama alguien de afuera:

| Ruta | Quién llama | Qué valida |
|---|---|---|
| `/api/compras/sheets/webhook` | el Apps Script de la planilla de Compras | su secreto |
| `/api/mantenimiento/sheets/webhook` | ídem, Mantenimiento | su secreto |
| `/api/facturacion/correo/webhook` | el Apps Script de la casilla de facturas | `FACTURACION_CORREO_SECRET` |
| `/api/agenda/google` | Google Calendar | el `X-Goog-Channel-Token` guardado en `agenda_canales` |

El cuarto es distinto a los tres primeros: su secreto **no es una variable de
entorno sino una fila**, porque se genera al abrir cada canal.

---

## 4. Qué hace cada carpeta

Una línea por carpeta, para saber dónde mirar. El detalle de cada módulo está
en su documento, enlazado desde [CLAUDE.md](../CLAUDE.md).

| Carpeta | Rutas | Para qué |
|---|---|---|
| `rrhh` | 54 | Legajos, asistencia, liquidaciones, vacaciones, francos y feriados. Incluye el espejo de las marcaciones del reloj Lenox |
| `mantenimiento` | 54 | Avisos, órdenes de trabajo, ejecuciones, planificación, MTBF, GUT, la programación del taller y los partes de contratista |
| `remises` | 30 | El submódulo de RRHH: hojas de ruta, viajes y la liquidación de los choferes |
| `compras` | 26 | Requerimientos, aprobaciones por área y órdenes de servicio |
| `cron` | 18 | Los procesos que corren solos. Ver arriba |
| `cantera` | 17 | Destape, voladuras, acarreo y pesadas |
| `calidad` | 12 | Envases, carbonilla, ensayos del laboratorio y la conciliación contra Odoo |
| `administracion` | 9 | Usuarios, permisos por módulo, empresas y sectores. Todas con `es_admin_check` |
| `taller-vial` | 8 | Partes del taller vial |
| `inventario` | 8 | Stock y movimientos del almacén |
| `facturacion` | 8 | El buzón de facturas de proveedores y su enlace con Odoo |
| `despacho` | 8 | Órdenes de carga y recepciones |
| `seguridad-higiene` | 5 | Condiciones inseguras detectadas en planta |
| `produccion` | 5 | El parte de fábrica por turno y los molinos desde el robot |
| `agenda` | 5 | Eventos propios y el espejo con Google Calendar |
| `mensajes` | 3 | Transversal: los hilos de mensajes pegados a un registro y las menciones de cada uno. Ver abajo |
| `trituracion` | 3 | Partes de las plantas de trituración |
| `odoo` | 3 | Lo que el SdG le pregunta o le postea al Odoo del grupo |
| `home` | 3 | Los avisos de la campana del inicio |
| `disponibilidad` | 2 | Transversal: quién está y quién falta, sin decir por qué |
| `push` | 1 | La suscripción a las notificaciones, por aparato |
| `mi-cuenta` | 1 | Lo que cada uno puede cambiar de lo suyo |
| `buscar` | 1 | La búsqueda global |
| `asistente` | 1 | El asistente que consulta la base en castellano |

### `mensajes`: tres rutas, cinco handlers, ningún módulo

Es la única carpeta que **no pertenece a un módulo**: la mensajería interna es
transversal, como Agenda y Disponibilidad, y por eso el detalle está acá y no
en el documento de un módulo. El diseño está en
[el spec](superpowers/specs/2026-11-11-mensajeria-interna-design.md).

| Handler | Qué hace |
|---|---|
| `GET /api/mensajes?tipo=&id=` | El hilo de un registro, del más nuevo al más viejo, con el autor y el estado del aviso de cada mención. **No marca nada como leído**, pero sí dice cuántas sin leer tiene acá quien pregunta (`mis_menciones_sin_leer`), que es lo único que la pantalla no puede contar sola: no conoce su propio id |
| `POST /api/mensajes` | Escribe un mensaje. Guarda el mensaje, después las menciones, y recién entonces manda los correos, en un `after()` |
| `GET /api/mensajes/destinatarios?tipo=` | A quién se puede mencionar en ese tipo de registro, y si el correo está configurado. Devuelve `tiene_correo`, nunca la dirección |
| `GET /api/mensajes/mios` | Las menciones propias sin leer, para la bandeja |
| `PATCH /api/mensajes/mios` | Marca como leídas las menciones propias de un hilo. Lo llama la pantalla **cuando alguien abre el hilo**, no el GET: desde el 12/11/2026 el hilo arranca plegado en una barra, y plegado nadie lo vio |

Cómo está conectada, en cuatro hechos que no se deducen de un archivo suelto:

- **No hay tabla de hilos.** Un hilo *es* el par `(entidad_tipo, entidad_id)`, y
  `entidad_id` **no tiene foreign key**: a propósito, para que un hilo pueda
  pegarse a tres tablas distintas. La consecuencia es que la base no puede
  contestar quién puede ver un registro, y por eso **el permiso lo pone la
  ruta**, con `ENTIDADES[tipo].puedeVerlo` de `lib/mensajes/entidades.ts`. Las
  tres leen con el cliente admin (sin él, `usuarios` sólo devuelve la fila
  propia y todos los autores saldrían en blanco).
- **`puedeVerlo` tiene que espejar la policy de SELECT de la tabla destino.** Es
  un contrato entre dos archivos que nada comprueba: si una tabla afloja su
  policy y el registro no se actualiza, el hilo queda más cerrado que el
  registro; al revés, se abre un agujero. Hoy un requerimiento lo ven los
  catorce (`puedeVerlo: () => true`) porque la migración 018 dejó así su SELECT,
  y no es un descuido.
- **Las dos cadenas de `select()` que traen el autor llevan el FK explícito**
  (`autor:usuarios!mensajes_creado_por_fkey(...)`). `mensajes_menciones` abre un
  segundo camino de `mensajes` a `usuarios`, así que `autor:usuarios(...)` a
  secas es ambiguo y PostgREST contesta **300 PGRST201**. Ningún test de este
  repo lo atrapa: las rutas no tienen tests y el embebido se resuelve del otro
  lado del cable.
- **El aviso es un correo y no un push**, y no pasa por
  `avisarAQuienDecide()`: ver la fila de la mensajería en
  [CLAUDE.md](../CLAUDE.md).

---

## 5. Antes de escribir una ruta nueva

Las reglas largas están en [CLAUDE.md](../CLAUDE.md); esto es el índice de las
que tocan a una ruta:

- **Si toca un campo que se exporta, tiene que exportar** — o dejar el pendiente
  anotado. Lo comprueba `node scripts/revisar-exportaciones.mjs`, que **exige
  una entrada por archivo que escriba una planilla**: si aparece uno sin
  declarar, sale ROMPE.
- **Si hace algo que no se deshace, tiene que auditar.** Son nueve verbos y
  la llamada la escribe la aplicación, no un trigger: es lo único que puede
  olvidarse.
- **Si lee una tabla que puede crecer**, `traerTodo()`.
- **Si valida un cuerpo y no tiene validación propia**, `validar()` de
  `lib/core/validar`, que informa todos los problemas juntos y en castellano.
- **Si puede tardar**, declarar `maxDuration`. Hoy lo hacen 51 rutas: 35 piden
  300 segundos, 9 piden 60 y 7 piden 120.
- **Lo que decide se saca a `lib/`**, porque las rutas no tienen tests. Es lo
  que permite probar una regla sin levantar un servidor.

Y después de escribirla, `npm run mapa-de-apis`: si la ruta nueva quedara
exenta del proxy sin validar nada, el script sale 1 y lo dice.
