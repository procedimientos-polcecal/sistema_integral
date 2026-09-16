# Asistente — preguntarle al sistema

Una IA transversal al SdG: se abre desde cualquier pantalla, contesta preguntas
sobre los datos del sistema y sobre cómo se usa, y puede dejar armada un alta
para que una persona la confirme. **Sólo el sistema es su fuente**: no busca en
internet ni contesta de memoria.

Es el primer componente del SdG que no es un módulo. No tiene sección propia, no
entra en `MODULOS_ORDEN` y no aparece en el sidebar: es una herramienta para
mirar lo que ya existe.

## Qué resuelve

Hoy, para saber cuántos requerimientos están pendientes del área de
Mantenimiento hay que entrar a Compras, ir al tablero, poner dos filtros y
contar. Para saber cuánto se despachó de cal en agosto contra julio no hay
pantalla: hay que exportar y hacerlo en una planilla. Y para saber *cómo* se
carga algo, hay que preguntarle a alguien.

Son tres preguntas de naturaleza distinta y las tres terminan en el mismo lugar:
alguien que sabe, interrumpido. El asistente contesta las tres.

## Las cinco decisiones que lo definen

Salieron del brainstorming y conviene tenerlas juntas, porque cada una cierra
una puerta:

1. **Datos primero, procedimiento después.** Lo que más se va a preguntar son
   datos; la documentación es el complemento.
2. **Lee y prepara; nunca escribe.** Puede dejar un alta lista, pero la
   confirma una persona en la pantalla de siempre.
3. **Crea cosas nuevas en estado pendiente; nunca cambia el estado de algo que
   ya existe.** Crear un RI es reversible y no dispara nada. Cambiar un estado
   sí: dispara exportaciones a planilla y, en Facturación, el posteo a Odoo, que
   es inmutable.
4. **Genera SQL.** Porque las preguntas de agregación importan tanto como las de
   listado, y ésas no se cubren con herramientas escritas a mano.
5. **Permiso propio, concedido desde Administración.** No por seguridad —de eso
   se ocupa RLS— sino por costo.

## Cómo se respetan los permisos

Éste es el punto de todo el diseño, así que va primero y con el detalle que
merece.

**El hallazgo que lo hace posible:** ocho de los nueve módulos ya tienen la
lectura gateada en la base. `tiene_acceso_rrhh()`, `mant_puede_ver()`,
`tiene_acceso_remises()`, `tiene_acceso_inventario()`,
`tiene_acceso_produccion()`, `tiene_acceso_despacho()`,
`tiene_acceso_facturacion()`, `tiene_acceso_cantera()`, y `es_admin_rrhh()` para
`liquidaciones`. El único abierto es Compras. No hay que reimplementar nada: hay
que **no puentearlo**.

Tres capas, y sólo la tercera sostiene:

| | Qué hace | Qué pasa si falla |
|---|---|---|
| 1 | La ruta rechaza a quien no tiene `puede_usar_asistente` | Un usuario sin permiso gasta plata |
| 2 | El catálogo de esquema se arma filtrado por los módulos del usuario | El modelo pregunta algo que no le van a contestar |
| 3 | **La consulta la ejecuta la sesión del usuario, con RLS encendido** | Nada: es la base la que decide |

La capa 2 hace que el asistente sea **útil** (prompt chico, y no le cuenta a un
operario de Remises que existe `liquidaciones`). La capa 3 hace que sea
**correcto**. Están separadas a propósito: un bug en la 2 no es una filtración,
es una pregunta sin respuesta.

### Lo que hereda y no corrige

**Compras es lectura abierta para todos los autenticados.** La 018 lo decidió
así y lo dejó escrito: *"el circuito de compras es transversal a toda la
empresa"*. El núcleo también: `empresas`, `sectores`, `empleados`, `proveedores`,
`productos`.

El asistente **no va a ser más estricto que el sistema**. Si hoy cualquier
usuario logueado ve los requerimientos entrando a la pantalla, también los va a
poder preguntar. Si eso incomoda, se arregla en las policies de Compras y el
asistente lo hereda solo — pero es un cambio a Compras, no al asistente.

Se escribe acá porque es exactamente la clase de cosa que se descubre tarde y
parece un bug del asistente.

### El permiso

Una columna en `usuarios`, no un valor del enum `app_module`:

```sql
alter table usuarios
  add column puede_usar_asistente boolean not null default false;
```

Dos razones. La conocida: un valor de enum nuevo tiene que viajar solo en su
migración (`55P04`, y ya pasó dos veces), y encima arrastraría al asistente a
`MODULOS_ORDEN` y al sidebar, donde no va. La conceptual: los módulos responden
*qué parte del sistema ves*; esto responde *con qué herramienta la mirás*. Son
ejes distintos, y mezclarlos ensucia `modulosVisibles`, que hoy se entiende
entera de una lectura.

El chequeo vive en **una** función, `puedeUsarAsistente(usuario)`, al lado de
`esAdminDelNucleo` en `lib/core/access.ts`. Mismo lugar y misma razón: cuatro
copias de una regla de permisos son tres de más, y la que se olvida de cambiar
es la que queda abierta.

Lo concede Administración con una casilla, junto a los módulos.

## El catálogo de datos

**Se genera, no se escribe a mano.** `scripts/generar-catalogo-asistente.mjs`
lee `information_schema` con la service role y escribe
`lib/asistente/catalogo.generado.json`: tablas, columnas, tipos, nullabilidad,
claves foráneas y los valores de cada enum. Se corre a mano cuando cambia el
esquema.

La razón de generarlo no es pereza: es que el esquema está nombrado en tres
épocas. `empleados` tiene `nombre`/`apellido`/`activo`; `equipos` tiene
`name`/`code`/`is_active`, porque viene del sistema en inglés que renombró la
029. Escrito a mano, una columna se copia mal una vez y el error queda escondido
en un archivo que nadie relee — y un SQL con la columna equivocada no falla:
devuelve filas, sólo que las que no son.

Al lado, dos archivos escritos por humanos:

- **`lib/asistente/notas.ts`** — qué significa cada tabla y sus trampas, en
  castellano. Acá va que en Compras el estado son dos campos
  (`estado_aprobacion` y `estado_compra`) y no uno; que `kg_por_unidad` puede ser
  null a propósito; que un enlace en null significa "no se reconoció" y no "no
  hay".
- **`lib/asistente/modulos.ts`** — qué tabla pertenece a qué módulo. **Cierra por
  defecto:** una tabla sin mapear no se le muestra a nadie, y el generador la
  reporta al final de la corrida. Es la diferencia entre que una tabla nueva
  quede invisible y que quede expuesta.

Armar el catálogo de un usuario es entonces una función pura,
`catalogoPara(modulos)`, testeable sin base ni red.

## La consulta

Una migración crea la función:

```sql
create or replace function public.asistente_consulta(consulta text)
returns jsonb
language plpgsql
stable                      -- STABLE para que PostgREST la acepte por GET
as $$ ... $$;
```

`security invoker` —el default, y acá es el punto entero: corre como el usuario,
con `auth.uid()` y RLS. Adentro:

- `set local statement_timeout = '8s'`
- valida que el texto empiece con `select` o `with` y no traiga `;`
- ejecuta y devuelve el resultado en `jsonb`, con un techo de filas explícito

Se llama así:

```ts
await supabase.rpc("asistente_consulta", { consulta }, { get: true });
```

**El `get: true` es la barrera real.** PostgREST corre los GET en una transacción
de sólo lectura, así que un `update` que se le escape al filtro de texto lo
rechaza Postgres. El filtro de texto queda igual, pero como conveniencia para
dar un mensaje claro, no como la defensa. Verificado en los typings del
`@supabase/postgrest-js` instalado: la opción existe.

Dos detalles de este repo que juegan a favor:

- Devolver `jsonb` **esquiva el corte en 1000 filas** de PostgREST, porque es un
  valor y no mil filas.
- El techo de filas lo pone la función, explícito, no un default que no avisa.

## El ciclo

El modelo recibe: la pregunta, el catálogo de sus módulos, y en qué pantalla
está parado (así "¿cuántos hay pendientes?" desde Compras se entiende). Tiene
tres herramientas:

**`consultar(sql)`** — lo de arriba. Hasta **tres intentos**: si Postgres
devuelve `column does not exist`, el error vuelve al modelo y corrige. Al cuarto
se rinde y lo dice.

**`leer_documento(nombre)`** — los 16 archivos de `docs/`, filtrados por los
mismos módulos. Para las preguntas de procedimiento. Sin embeddings ni base
vectorial: son 16 archivos y el modelo elige uno por el nombre. Lo que no hace
falta, no se construye.

**`armar_carga(tipo, campos)`** — la sección siguiente.

**La respuesta siempre muestra el SQL que corrió**, plegado, con las filas que
volvieron. No es transparencia decorativa: es lo único que convierte un número
equivocado en un número *detectablemente* equivocado.

### El riesgo asumido

Con SQL generado, **de vez en cuando va a dar un número que parece correcto y no
lo es.** No se elimina. Se hace visible, y se acota con el prompt: el asistente
tiene permiso explícito para decir "no sé". Si a los tres intentos no sale,
contesta que no pudo y muestra lo que intentó. Es infinitamente mejor que un
número inventado.

### Por qué no vistas de consulta (todavía)

La alternativa evaluada era crear diez o quince vistas en castellano
(`consulta_requerimientos`, `consulta_ordenes_trabajo`) que aplanen los joins y
normalicen los nombres, con `security_invoker` para heredar RLS. Es más preciso.

Se descarta **por orden, no por esfuerzo**: se estarían diseñando antes de saber
qué se pregunta, que es exactamente cómo Despacho terminó con dos supuestos
falsos sobre su libro. Como la primera versión muestra siempre el SQL, en dos
semanas la bitácora dice qué vistas valen la pena, en vez de quince adivinadas
de las que se usan cuatro.

## Las cargas

La IA no escribe. `armar_carga` **devuelve una URL** a la pantalla de siempre,
con los campos puestos.

Esto no inventa una convención: el repo ya tiene *la URL es el estado de la
pantalla*, escrita una vez en `usarLaUrl.ts` y `filtrosUrl.ts` después de que
Compras y las OT la duplicaran.

| Alta | Dónde vive hoy | URL que arma | Qué falta construir |
|---|---|---|---|
| Requerimiento interno | Modal en el listado (`NuevoRequerimientoModal`) | `/compras/requerimientos?nuevo=1&descripcion=…&codigo=…&cantidad=…` | Sólo el cableado URL → `inicial` en `RequerimientosClient` |
| Movimiento de inventario | Página propia | `/inventario/movimientos/nuevo?articulo=…&cantidad=…` | Sólo `cantidad`: `articulo` ya anda |
| Aviso de mantenimiento | Modal en el listado (`NuevoAvisoModal`) | `/mantenimiento/avisos?nuevo=1&equipo=…&descripcion=…` | Una prop `inicial` en el modal, y el cableado |
| Parte de producción | Página por fecha y turno | `/produccion/parte/2026-09-16/<turno>` | **Nada**: la ruta ya existe |

`urlDeCarga(tipo, campos)` es una **función pura**: valida el tipo, valida que
los campos existan para ese tipo, escapa, y devuelve la ruta. Se testea con
vitest sin base ni red.

### El trabajo es menos del que parecía, y el motivo importa

`NuevoRequerimientoModal` **ya recibe una prop `inicial: ValoresIniciales`**: la
usa `RepuestosOTModal` desde Mantenimiento cuando el pañol no tiene un repuesto,
para no volver a tipear el código. `/inventario/movimientos/nuevo` **ya lee
`?articulo=`**, y lo resuelve en el servidor por id porque son 2.800 artículos.
Y el parte de producción ya tiene ruta por fecha y turno.

O sea que de las cuatro altas, una está entera, dos están a mitad de camino y
sólo el aviso de mantenimiento necesita la prop. El asistente no inaugura la
idea de "abrir un formulario con cosas puestas": se suma a una que el sistema ya
usa.

### Lo que el RI no deja precargar, y hay que respetarlo

El comentario de `ValoresIniciales` es explícito: **el área y quién paga no se
pueden precargar, a propósito.** Son decisiones de quien pide, y elegirlas por
él es cómo un pedido de Mantenimiento entra como si fuera de Producción.

Así que `urlDeCarga("requerimiento", …)` **no acepta `area`** — y no como olvido
sino como validación: si el modelo la manda, la función la rechaza. Es la misma
regla de siempre —enlazar al que se le parece es peor que dejar en null— sólo
que acá ya está escrita en el código y el asistente la obedece en vez de
reinventarla.

El resto se hereda igual:

- Si el modelo se equivoca en un campo, **se ve antes de guardar**, porque quien
  confirma está mirando el formulario de siempre. Ésa es la defensa entera de
  este diseño.
- Si no reconoce el artículo o el equipo con certeza, el campo va vacío y lo
  dice. Un enlace equivocado no se nota nunca.

Y la propiedad que no se negocia: ninguno de estos cambios toca el guardado. La
validación, la exportación a planilla y el manejo de `sheets_pendiente` siguen
siendo **los de siempre, sin una segunda copia**. Un segundo camino de escritura
es un camino que se puede olvidar de exportar, y eso es una divergencia que no
avisa.

## La pantalla

Un panel lateral, montado desde el `Header` del layout de `(app)`, con atajo de
teclado. Aparece en las nueve secciones sin tocar ninguna. Sabe en qué pantalla
está parado el usuario.

No hay pantalla completa en esta versión. Es lo que se quiere a la larga, pero
sólo se gana el lugar cuando las respuestas ya son buenas.

## Errores y costo

**Errores.** Un fallo del modelo o del gateway **no es un `console.warn`**: se
muestra lo que dijo el proveedor, **sin traducir**, y se le dice a quien
preguntó. Misma regla que costó una tarde entera con Google: un diagnóstico que
no se distingue de otro no es un diagnóstico.

**Costo.** Un tope diario por usuario, contado en `asistente_consultas`: quién,
cuándo, la pregunta, el SQL que corrió, tokens. Sirve para dos cosas a la vez —
cortar el gasto, y ser la bitácora que dice qué se pregunta de verdad (que es lo
que después decide las vistas).

**El modelo.** Vercel AI Gateway con AI SDK v6, `anthropic/claude-sonnet-5`.
Gateway porque el sistema ya vive en Vercel y evita atarse a un proveedor. La
variable nueva va documentada en `docs/VARIABLES-VERCEL.md`, como todas.

## Qué se testea

Vitest sobre funciones puras, como el resto del repo:

- `catalogoPara(modulos)` — que un usuario sin RRHH no reciba `liquidaciones`;
  que una tabla sin mapear no salga para nadie.
- `validarConsulta(sql)` — que pase un `select`, que rechace `update`, `;`, y un
  `insert` disfrazado en un comentario.
- `urlDeCarga(tipo, campos)` — los cuatro tipos, `area` rechazada en el RI,
  escapado correcto.
- `puedeUsarAsistente(usuario)`.

Y uno que **no** es puro y va igual: un test que llama a `asistente_consulta` con
un `update` contra la base real y verifica que Postgres lo rechaza. Leer que
PostgREST usa transacción de sólo lectura no alcanza; hay que correr la
operación final.

## Migraciones (las corre una persona)

Dos archivos, y hasta que no corran la ruta no tiene contra qué trabajar:

1. `usuarios.puede_usar_asistente` — la columna del permiso.
2. `asistente_consulta(text)` + la tabla `asistente_consultas` con su RLS (cada
   usuario ve sus propias consultas; `admin_sistema` las ve todas).

Ninguna toca un enum, así que no aplica la regla del `55P04`.

## Qué queda afuera, a propósito

- **Cambiar estados.** Ninguna herramienta lo permite. Si algún día entra, entra
  con una lista cerrada de estados, nunca como capacidad general.
- **Vistas de consulta.** Se deciden con la bitácora en la mano.
- **Pantalla completa del asistente.** Cuando las respuestas sean buenas.
- **Buscar fuera del sistema.** Nunca: la fuente es el SdG y nada más.
- **Abrirlo a todos los usuarios.** Es el paso siguiente natural, y es borrar un
  chequeo — cuando los números den bien y el gasto sea conocido.
