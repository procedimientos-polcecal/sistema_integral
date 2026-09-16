# Asistente — preguntarle al sistema

Una IA transversal a los diez módulos: se abre con Ctrl+K desde el `Header` de
`(app)`, contesta preguntas sobre los datos del sistema y sobre cómo se usa, y
puede dejar armada un alta para que una persona la confirme. El diseño acordado
está en
[docs/superpowers/specs/2026-09-16-asistente-design.md](superpowers/specs/2026-09-16-asistente-design.md)
— léalo entero antes de tocar el código: tiene las cinco decisiones que lo
definen y sus porqués, y este documento no las repite, sólo remite a ellas
cuando hace falta.

## Qué es y qué no es

**Lee y prepara; nunca escribe.** Las tres herramientas del modelo son
`consultar` (un `SELECT` contra la base, con la sesión de quien pregunta),
`leer_documento` (los archivos de `docs/`, filtrados por módulo) y
`armar_carga` (una URL a un formulario existente, con campos precargados). Ninguna
inserta ni actualiza una fila.

**Crea altas pendientes; nunca cambia el estado de algo que ya existe.** Crear
un requerimiento es reversible y no dispara nada por sí solo. Cambiar un estado
sí: dispara una exportación a planilla en Compras, Mantenimiento e Inventario,
y en Facturación un asiento en Odoo que, una vez posteado, es inmutable (ver
[docs/FACTURACION.md](FACTURACION.md)). Por eso ninguna herramienta del
asistente toca un estado, y si algún día se agrega esa capacidad tiene que
entrar con una lista cerrada de estados permitidos, nunca como algo genérico.

Lo que sí hace: arma la URL con `urlDeCarga()` (`lib/asistente/urlDeCarga.ts`)
y la pantalla de siempre hace lo de siempre —su validación, su exportación a
planilla, su `sheets_pendiente`—. Un segundo camino de escritura es un camino
que se puede olvidar de exportar, y eso es una divergencia que no avisa. La
persona que confirma está mirando el formulario de siempre antes de guardar:
ésa es la defensa entera de este diseño, no una revisión aparte.

## Cómo se respetan los permisos

Tres capas, y conviene tenerlas separadas en la cabeza porque cada una falla
distinto:

| Capa | Qué hace | Si falla |
|---|---|---|
| 1 — la ruta | Rechaza a quien no tiene `puede_usar_asistente` (`app/api/asistente/route.ts`, `puedeUsarAsistente()` en `lib/core/access.ts`) | Un usuario sin permiso gasta plata en llamadas al modelo |
| 2 — el catálogo | Se arma filtrado por los módulos del usuario (`tablasVisibles()` en `lib/asistente/modulos.ts`) | El modelo pregunta algo que la base le va a devolver vacío: una pregunta sin respuesta, no una filtración |
| 3 — RLS | **La que sostiene.** La consulta la ejecuta la sesión del propio usuario, con RLS encendido | Nada: es la base la que decide, igual que en cualquier pantalla |

La capa 2 hace que el asistente sea *útil* (prompt chico, y no le nombra
`liquidaciones` a un operario de Remises). La capa 3 hace que sea *correcto*.
Un bug en la 2 no es un agujero de seguridad — es la 3 la que de verdad filtra.

### Lo que hereda y no corrige

El asistente no es más estricto que el sistema: si hoy cualquier autenticado
puede leer una tabla desde una pantalla, también la va a poder leer
preguntando. Medido el 16/09/2026 cruzando `information_schema.tables` con
`pg_policies` —no leyendo migraciones, que daba una cifra mucho más baja—:
**30 de las 102 tablas son legibles por cualquier autenticado.**

- **Todo Compras**, por decisión explícita de la 018 ("el circuito de compras
  es transversal a toda la empresa").
- **Los catálogos del núcleo.**
- **Media Mantenimiento**: `equipos`, `equipos_checklists`,
  `equipos_status_log`, `ordenes_trabajo`, `mantenimientos_programados`,
  `mantenimientos_ejecuciones`, `planificacion_diaria` y
  `planificacion_diaria_items` vienen con `using (true)` desde la 006, y la
  029 —que cerró `avisos`, `ordenes_servicio`, `os_comparativas` y las demás
  con `mant_puede_ver()`— no llegó a éstas. No parece deliberado, y sigue
  siendo una decisión abierta (ver Pendientes).

**No tocar:** `cantera_finanzas`, `compras_aprobadores` y `os_aprobadores` son
padrones de permisos —tablas de `usuario_id`, quién puede conciliar o aprobar—,
no datos del negocio. Se leen abiertas a propósito porque la navegación las
consulta para decidir qué dibujar; cerrarlas rompe el menú. El nombre de
`cantera_finanzas` engaña: no es plata, son seis ids.

Cerrar una policy abierta por olvido es del sistema, no del asistente: el
asistente hereda el cierre solo. Filtrar por su cuenta sería inventar una
segunda definición de permisos, y la que se olvide de actualizar es la que
queda mal.

### El permiso

Una columna en `usuarios` (`puede_usar_asistente`), no un valor del enum
`app_module`. No es un permiso de datos —de eso se ocupa RLS— sino de **costo**:
cada pregunta son dos o tres llamadas al modelo con el catálogo entero de
entrada. Arranca en `false` para todos y lo concede Administración con una
casilla. `admin_sistema` pasa siempre.

## La barrera de sólo lectura

**Es el `stable` de `asistente_consulta()`, no el `{ get: true }` de la
llamada.** Medido contra la base el 16/09/2026: PostgREST corre en una
transacción de sólo lectura toda función declarada `stable` —**también por
POST**, no sólo por GET—. La garantía la da la declaración de la función. El
`get: true` se usa igual porque es lo que hace que PostgREST acepte el GET y es
honesto sobre lo que la llamada hace, pero no es lo que sostiene nada.

Quien vaya a tocar `asistente_consulta()` tiene que saber esto antes de
cambiar una palabra: el día que alguien le saque el `stable` —"me tiraba error
y lo puse volatile"— **la garantía desaparece en silencio**, y ni el
`get: true` ni el guard de texto de `validarConsulta()` la reemplazan.

Por eso el test que la cubre (`lib/asistente/consulta.test.ts`, contra la base
real) no manda un `UPDATE` —eso lo frena el guard de texto, antes de salir— ni
un CTE que escribe —eso lo frena el envoltorio `select * from (…) sub` de la
función, porque un CTE que modifica tiene que ir en el nivel superior—. Las dos
formas obvias de probarlo dan verde por la razón equivocada. Lo único que mide
la barrera de verdad es preguntarle a la transacción en qué modo está:

```sql
select current_setting('transaction_read_only')  -- tiene que dar 'on'
```

Si ese test se pone rojo, el asistente dejó de ser de sólo lectura y nada más
lo va a notar.

El guard de texto (`validarConsulta()` en TypeScript, espejado dentro de la
función en SQL) sigue siendo útil, pero como conveniencia: evita un viaje de
red cuando el modelo se equivoca feo y devuelve un motivo en castellano para el
intento siguiente. Los dos espejos pelan sólo el **prólogo** —espacios y
comentarios del principio, nada más— porque pelar cualquier comentario abre un
falso permiso: en `select '--' ; delete from empresas`, un `--` que vive dentro
de un literal se come el resto de la línea. Si se toca uno de los dos guards,
se toca el otro (`lib/asistente/validarConsulta.ts` y la migración
`20260916093012_asistente_el_prologo_de_la_consulta.sql`).

## Cómo se regenera el catálogo

```bash
npm run catalogo
```

Corre `scripts/generar-catalogo-asistente.mts` con la service role, lee
`information_schema` y los `pg_enum`, y escribe
`lib/asistente/catalogo.generado.json` (hoy: 102 tablas, 1.184 columnas, 27
enums). Se regenera **a mano cuando cambia el esquema** — no hay hook que lo
dispare solo.

**El reporte de tablas sin mapear al final de la corrida no es un adorno.**
`lib/asistente/modulos.ts` (`MODULO_DE_TABLA`) cierra por defecto: una tabla
que no está ahí no se le muestra a nadie, y ni el modelo ni quien pregunta se
enteran de que existe. Es la diferencia entre una tabla nueva invisible —se
nota, alguien pregunta por qué el asistente no la conoce— y una expuesta sin
que nadie lo haya decidido. Cada vez que se corre `npm run catalogo` después de
una migración que agrega una tabla, hay que mirar esa lista y agregar la
entrada en `MODULO_DE_TABLA` (o dejarla afuera a propósito, si es una tabla que
no le sirve a nadie preguntar, como `asistente_consultas`).

El catálogo por módulo pesa entre 4.820 caracteres (Producción) y 11.789
(Mantenimiento) — conviene tenerlo presente si se agregan notas largas: es
prompt que se manda en cada pregunta.

## Dónde tocar cuando una respuesta sale mal

**Casi siempre es una nota que falta en `lib/asistente/notas.ts`, no el
prompt.** `systemPrompt()` (`lib/asistente/prompt.ts`) es genérico a propósito
—dice cómo comportarse, no qué significa cada tabla—. Lo que hace que el
modelo entienda que `compras_requerimientos` tiene el estado partido en dos
campos, o que `equipos` usa `name`/`code`/`is_active` en inglés, son las notas
de `NOTAS`. Si el asistente contesta mal porque interpretó una columna al
revés o no supo qué campo filtrar, la corrección casi siempre es una línea
nueva ahí, escrita en castellano, igual que se le explicaría a un desarrollador
que llega nuevo. Tocar `prompt.ts` es para cambiar cómo se comporta el
asistente en general (cuántos intentos, cómo cita el SQL), no para enseñarle
el significado de una tabla puntual.

## El riesgo asumido

**Con SQL generado, de vez en cuando el asistente va a dar un número que
parece correcto y no lo es.** No se elimina con más prompt ni más notas: es
inherente a que la consulta la escribe un modelo. Se hace visible en vez de
esconderse — la respuesta muestra **siempre** el SQL que corrió, plegado, con
las filas que volvieron (`Mensaje` en `components/Asistente.tsx`). Eso es lo
único que convierte un número equivocado en un número *detectablemente*
equivocado: sin la consulta a la vista, un número mal calculado no se
distingue de uno bien calculado.

El prompt le da permiso explícito para decir "no sé": si a los tres intentos
de `consultar` no sale, tiene que decir que no pudo y mostrar qué intentó. Es
preferible a un número inventado, pero no reemplaza mirar el SQL.

## Qué mirar en `asistente_consultas` para las vistas de consulta

El spec dejó las vistas de consulta (`consulta_requerimientos`, etc.) para
después, deliberadamente: diseñarlas antes de saber qué se pregunta es
exactamente cómo Despacho terminó con dos supuestos falsos sobre su libro. La
bitácora (`asistente_consultas`, con `sql_corrido`, `error`, `filas`,
`tokens_entrada/salida`, `usuario_id` y `creado_en`) es la forma de decidir
esto con datos y no adivinando. Dos cortes concretos:

- **Agrupar por si hubo error** (`error is not null`): qué proporción de
  preguntas termina en "no sé" o en un `column does not exist`, y si se
  repiten sobre las mismas tablas — eso señala una nota que falta en
  `notas.ts` antes que una vista.
- **Agrupar por qué tablas aparecen en `sql_corrido`** (con un `like` por
  nombre de tabla, ya que no hay una columna estructurada para esto): las
  tablas que se consultan con más frecuencia y con consultas más repetidas
  entre sí son las candidatas a una vista que aplane el join, en vez de
  quince vistas adivinadas de las que se usan cuatro.

## El tope diario, el tope de filas y el timeout

- **`TOPE_DIARIO` en `app/api/asistente/route.ts`, hoy 50.** Es un freno de
  gasto, no de seguridad: se cambia editando esa constante y desplegando. Se
  cuenta contra `asistente_consultas` con la sesión del propio usuario, y la
  policy de esa tabla ya limita a cada uno a ver sus propias filas
  (`admin_sistema` las ve todas).
- **El tope de filas es 200** (`TOPE_DE_FILAS` en `lib/asistente/consulta.ts`,
  con el mismo default en la función `asistente_consulta(consulta, tope)` de
  la base). **El corte no avisa**: un resultado de 200 filas se ve igual que
  uno completo. Por eso el prompt y las notas generales del catálogo le piden
  al modelo que agregue (`count`, `sum`, `group by`) en vez de traer filas
  cuando el resultado puede pasarse del tope.
- **El `statement_timeout` del rol `authenticated` es 8 segundos** (`anon`:
  3s), puesto por Supabase — **no se puede fijar dentro de la función**:
  `statement_timeout` no se cambia para la sentencia que ya está corriendo, así
  que un `set local` ahí adentro sería una falsa tranquilidad. Si hace falta
  otro valor, se cambia en la configuración del rol, no en
  `asistente_consulta()`.

## Lo que quedó sin verificar

**El AI Gateway de Vercel todavía no atiende: el equipo necesita cargar una
tarjeta de crédito.** Esto quiere decir que **el asistente nunca se ejercitó
contra un modelo real** — ni una sola pregunta real le llegó a
`anthropic/claude-sonnet-5` a través de la ruta completa. Lo que sí está
verificado:

- Tipos (`tsc`) y build.
- Las funciones puras con vitest: `catalogoPara()`, `validarConsulta()`,
  `urlDeCarga()`, `puedeUsarAsistente()`, `systemPrompt()`,
  `documentosPara()`/`rutaDelDocumento()`.
- `lib/asistente/consulta.test.ts` contra la base real (se salta si no hay
  `ASISTENTE_TEST_EMAIL`/`ASISTENTE_TEST_PASSWORD` en el entorno): la
  transacción de sólo lectura, el guard de texto, el corte en 200 filas, RLS
  en las dos direcciones (ve `avisos`, no ve `liquidaciones`, con un usuario
  de prueba que sólo tiene Mantenimiento en lectura), y que el error de
  Postgres vuelve sin traducir.

Lo que **no** está probado con nada de esto: que el modelo elija bien la
herramienta, que respete el prompt, que el streaming funcione en el navegador
con `@ai-sdk/react`, que `armar_carga` reciba del modelo los campos que
realmente hacen falta, o el costo real de tokens por pregunta. Es lo primero
que alguien va a asumir que sí se probó, precisamente porque el resto del
módulo sí lo está — hay que decirlo con todas las letras cada vez que se
retome esto.

Nota de versión: `ai` es **v7**, no v6 como decía el plan original —
`convertToModelMessages()` es async en v7 y no lo era en v6, y la ruta ya lo
tiene en cuenta (`await convertToModelMessages(mensajes)`).

## Pendientes

1. **Sumar `CALIDAD.md` y `CALIDAD-ENVASES.md` a `AMBITO_DEL_DOCUMENTO`
   (`lib/asistente/documentos.ts`).** El módulo Calidad se construyó en
   paralelo a esto y todavía se movía cuando se armó la lista de documentos:
   hoy `documentos.ts` mapea 16 archivos y `docs/` tiene 18 — los dos de
   Calidad quedaron afuera de los dos (no sólo `CALIDAD-ENVASES.md`, que es el
   que se había anotado al principio). Mientras no se agreguen, `leer_documento`
   los rechaza con "no tenés acceso o no existe" para cualquier usuario, incluido
   uno con Calidad. Es una lista explícita a propósito —no un `readdir`—, así
   que agregarlos es sumar dos líneas con `ambito: "calidad"`, no cambiar el
   mecanismo.
2. **Media Mantenimiento con lectura abierta a cualquier autenticado**
   (`equipos`, `ordenes_trabajo`, `mantenimientos_*`, `planificacion_diaria*`)
   es una decisión de la base que quedó sin cerrar en la 029, no del
   asistente — ver [Lo que hereda y no corrige](#lo-que-hereda-y-no-corrige).
   Cerrarla es tocar policies de Mantenimiento, con su propio análisis de a
   quién le rompe el acceso hoy; el asistente sólo la hereda y la va a seguir
   heredando hasta que se decida.

## Dónde está cada cosa

| | |
|---|---|
| Permiso | `lib/core/access.ts` — `puedeUsarAsistente()` |
| Guard de texto | `lib/asistente/validarConsulta.ts`, espejado en la función `asistente_consulta()` |
| Qué tabla es de quién | `lib/asistente/modulos.ts` — `MODULO_DE_TABLA`, `tablasVisibles()` |
| Notas escritas a mano | `lib/asistente/notas.ts` — `NOTAS`, `NOTAS_GENERALES` |
| Catálogo generado | `lib/asistente/catalogo.generado.json` (`npm run catalogo`) |
| Armar el catálogo de un usuario | `lib/asistente/catalogo.ts` — `armarCatalogo()`, `catalogoPara()` |
| Ejecutar la consulta | `lib/asistente/consulta.ts` — `correrConsulta()` |
| El prompt | `lib/asistente/prompt.ts` — `systemPrompt()` |
| Qué documento puede leer cada uno | `lib/asistente/documentos.ts` |
| La URL de una carga | `lib/asistente/urlDeCarga.ts` — `urlDeCarga()` |
| La ruta, las tres herramientas y el tope diario | `app/api/asistente/route.ts` |
| El panel | `components/Asistente.tsx` |
| El generador del catálogo | `scripts/generar-catalogo-asistente.mts` |
| Migraciones | `20260916090619_asistente_el_permiso.sql`, `20260916090639_asistente_la_consulta_y_la_bitacora.sql`, `20260916093012_asistente_el_prologo_de_la_consulta.sql` |
| Diseño acordado | [specs/2026-09-16-asistente-design.md](superpowers/specs/2026-09-16-asistente-design.md) |

## Cómo se verifica

```bash
npx vitest run lib/asistente
```

Cubre las funciones puras de la lista de arriba. El único test que no es puro
y corre igual es `consulta.test.ts` contra la base real (ver [Lo que quedó sin
verificar](#lo-que-quedó-sin-verificar)): necesita
`ASISTENTE_TEST_EMAIL`/`ASISTENTE_TEST_PASSWORD` en el entorno, y se salta solo
si no están.
