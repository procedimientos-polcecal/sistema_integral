# SdG — Sistema de Gestión (Polcecal / Polysan)

Un ERP que unifica en una sola app lo que eran tres, sobre un núcleo de datos
compartido. **Next.js 16 + Supabase, desplegado en Vercel.** En producción:
https://www.polcecalpolysan.app

Diez módulos: **RRHH** (con **Remises** como submódulo), **Mantenimiento**,
**Compras**, **Inventario**, **Producción**, **Despacho**, **Facturación**,
**Cantera** y **Calidad**. Cada uno vive en `app/(app)/<modulo>`, `lib/<modulo>`
y `app/api/<modulo>`.

**Producción y Calidad son dos cosas distintas y se confunden fácil**, porque las
carga la misma gente: Producción es el parte de fábrica por turno, y Calidad es
lo que ese sector lleva aparte —el stock de envases, el de carbonilla y los
ensayos del laboratorio—.

**Facturación se enlaza con el Odoo del grupo**, que es donde vive la
contabilidad de verdad. La regla que gobernaba ese enlace era **el SdG propone,
Odoo confirma**; desde el 11/09/2026, a pedido, el SdG **también puede postear**
el borrador que él mismo creó, con dos condiciones: que una persona lo confirme
explícitamente y que el total coincida con el comprobante. Lo que no cambió es
que **el SdG no inventa asientos**: postea el que creó desde una factura que
entró por el buzón, nunca uno armado a mano. Un asiento posteado es inmutable,
así que esa acción no se deshace desde el sistema — el detalle está en
[docs/FACTURACION.md](docs/FACTURACION.md).

Todo se escribe en **castellano**: nombres, comentarios, mensajes de pantalla y
de commit.

## Antes de retomar un módulo, leer su documento

No están para archivo: tienen las decisiones y las trampas que no se deducen del
código.

| | |
|---|---|
| Compras | [docs/COMPRAS-ESTADO.md](docs/COMPRAS-ESTADO.md) · [COMPRAS.md](docs/COMPRAS.md) · [COMPRAS-SINCRONIZACION.md](docs/COMPRAS-SINCRONIZACION.md) |
| Mantenimiento | [docs/MANTENIMIENTO-INTEGRACION.md](docs/MANTENIMIENTO-INTEGRACION.md) — GUT (21/10): la sección `## La matriz GUT` de ese documento y el [spec](docs/superpowers/specs/2026-10-21-mantenimiento-gut-design.md). Tres cosas que no se deducen del código: `gut_orden` es una columna generada y **no es el puntaje** (lleva el 27 de "sin puntaje" y el +1000 de las abiertas: imprimirla muestra 1027); el 27 está escrito en dos lugares, el `coalesce` de la migración y `lib/mantenimiento/gut.ts`, con un test que los ata; y el GUT **no se exporta a ninguna planilla** — MTBF: [spec](docs/superpowers/specs/2026-10-16-mantenimiento-mtbf-design.md) · [plan](docs/superpowers/plans/2026-10-16-mantenimiento-mtbf.md) — partes de contratista: [spec](docs/superpowers/specs/2026-10-20-mantenimiento-partes-de-contratista-design.md) |
| RRHH | [docs/RRHH-ACTUALIZACION.md](docs/RRHH-ACTUALIZACION.md) · marcaciones desde Lenox: [spec](docs/superpowers/specs/2026-10-07-rrhh-marcaciones-desde-lenox-design.md) · [plan](docs/superpowers/plans/2026-10-07-rrhh-marcaciones-desde-lenox.md) |
| Inventario | los tres specs de `docs/superpowers/specs/2026-09-02-inventario-*` |
| Producción | [docs/PRODUCCION.md](docs/PRODUCCION.md) · [spec](docs/superpowers/specs/2026-09-07-produccion-design.md) |
| Despacho | [docs/DESPACHO.md](docs/DESPACHO.md) · [spec](docs/superpowers/specs/2026-09-08-despacho-ordenes-de-carga-design.md) |
| Calidad | envases: [docs/CALIDAD-ENVASES.md](docs/CALIDAD-ENVASES.md) · [spec](docs/superpowers/specs/2026-09-15-produccion-envases-design.md) · [plan](docs/superpowers/plans/2026-09-15-produccion-envases.md) — carbonilla: [docs/CALIDAD.md](docs/CALIDAD.md) · [spec](docs/superpowers/specs/2026-09-16-calidad-stock-de-carbonilla-design.md) · [plan](docs/superpowers/plans/2026-09-16-calidad-stock-de-carbonilla.md) · la planilla manda (13/10): [spec](docs/superpowers/specs/2026-10-13-calidad-la-planilla-manda-design.md) · [plan](docs/superpowers/plans/2026-10-13-calidad-la-planilla-manda.md) — ensayos: [docs/CALIDAD-ENSAYOS.md](docs/CALIDAD-ENSAYOS.md) · [spec](docs/superpowers/specs/2026-10-06-calidad-ensayos-design.md) · [plan](docs/superpowers/plans/2026-10-06-calidad-ensayos.md) |
| Facturación | [docs/FACTURACION.md](docs/FACTURACION.md) · [spec](docs/superpowers/specs/2026-09-04-facturacion-proveedores-odoo-design.md) |
| Asistente | [docs/ASISTENTE.md](docs/ASISTENTE.md) · [spec](docs/superpowers/specs/2026-09-16-asistente-design.md) |
| Odoo | [docs/ODOO-INTEGRACION.md](docs/ODOO-INTEGRACION.md) |
| Login y correos | [docs/AUTENTICACION.md](docs/AUTENTICACION.md) |
| Respaldo | [docs/RESPALDO.md](docs/RESPALDO.md) |
| Variables de entorno | [docs/VARIABLES-VERCEL.md](docs/VARIABLES-VERCEL.md) |
| Migraciones | [supabase/migrations/README.md](supabase/migrations/README.md) |

Los diseños acordados viven en `docs/superpowers/specs/`. Cuando una decisión no
es obvia, lo más probable es que ya esté explicada ahí o en el comentario de una
migración.

## Puede haber otra sesión en el mismo árbol

Pasa seguido y ya costó tres veces en un día. Dos consecuencias:

- **Nunca `git add -A`.** Agregá sólo los archivos que tocaste, por nombre. Un
  `add -A` se llevó una vez el trabajo a medio hacer de otra sesión dentro de un
  commit que hablaba de otra cosa.
- **Si `tsc` o los tests fallan en archivos que no tocaste**, mirá `git status`
  antes de arreglarlos: puede ser un refactor en curso de otra sesión. Arreglarlo
  es pisarlo.

Las migraciones nuevas llevan **marca de tiempo** y no un contador, justamente
porque dos sesiones toman el mismo "próximo número libre" y chocan:

```bash
npm run migracion "descripcion corta"
```

## Las migraciones las corre una persona

Las aplica el usuario **a mano en el editor SQL de Supabase**. No hay CLI ni
tabla de control. Un agente puede escribir la migración y, si es sólo DML,
aplicar el equivalente por PostgREST — pero **no puede correr DDL**. Cuando una
tarea depende de una tabla o columna nueva, hay que decirlo y quedar a la espera.

Antes de escribir una, leer las ocho trampas del
[README de migraciones](supabase/migrations/README.md). Dos de ellas ya pasaron
**dos veces**:

- Un valor de enum nuevo **viaja solo** en su propio archivo (`55P04`).
- Un **índice parcial no sirve** como destino de `ON CONFLICT`.
- Una **función en un índice necesita el cast explícito** (`42P17`):
  `date_trunc('month', fecha)` sobre un `date` resuelve a la variante
  `timestamptz`, que es `STABLE`. Va `fecha::timestamp`.
- Una **migración aplicada no se edita**: se corrige con otra. Nada avisa si ya
  corrió, y el archivo editado miente sobre lo que hay en la base.

## Reglas de la base que muerden

- **PostgREST corta en 1000 filas y no avisa**: `.limit(3000)` devuelve 1000.
  Usar `traerTodo()` de `lib/core/paginado.ts` en cualquier tabla que pueda
  crecer. No razonar "esta tabla es chica": el tablero de Compras parecía una
  cola acotada y arrastra 1.900 filas.
- **Un `.in()` con muchos ids** arma una URL que PostgREST rechaza con un 400 sin
  decir por qué. Filtrar por una condición, o de a lotes de 200.
- **Un `select()` armado en una variable** pierde la inferencia de tipos de
  Supabase. La cadena va literal.
- **Los catálogos del núcleo los comparten los seis módulos**: `usuarios`,
  `sectores`, `equipos`, `empleados`, `proveedores`. Se leen; no se borran ni se
  rehacen desde un módulo.
- **El valor hora NO está en `empleados`**: vive en `rrhh_empleados_datos` desde
  el 22/09/2026, porque `empleados` tiene la lectura abierta a cualquier
  autenticado y RLS no sabe tapar una columna sola. Se lee con
  `valorHoraDe()`/`conValorHoraPlano()` de `lib/rrhh/valorHora.ts`, que resuelven
  las dos formas del embed. Y ojo con esto: **cualquier módulo que lo lea depende
  de que quien mire tenga acceso a RRHH**, porque esa tabla está cerrada con
  `tiene_acceso_rrhh()`. A quien no lo tenga le llega 0, sin error. Hoy lo lee
  Cantera, en Destape. `empleados.domicilio` directamente ya no existe: estaba
  vacío en las 70 filas y el domicilio de verdad es
  `remises_empleados_datos.direccion`.
- **Lo que no se deshace se audita.** Desde el 05/10/2026 hay una tabla
  `auditoria` en el núcleo y una función `auditar()` en
  [lib/core/auditoria.ts](lib/core/auditoria.ts). Hoy la llaman seis rutas:
  postear un asiento en Odoo, mover los permisos de un usuario, cerrar una
  liquidación, ajustar stock y aprobar o denegar una compra. **Si agregás una
  acción irreversible, agregá la llamada** — la escribe la aplicación y no un
  trigger, así que es lo único que puede olvidarse. El porqué de esa decisión,
  medido, está en el
  [spec](docs/superpowers/specs/2026-09-22-auditoria-de-lo-irreversible-design.md)
  y en el encabezado de la migración `20261005090646`. La tabla es inmutable de
  verdad: no tiene policy de update ni de delete, y además un trigger las
  rechaza, que es lo único que frena al cliente admin. La lee sólo
  `admin_sistema`.
- **Un cuerpo que entra se valida con zod**, con `validar()` y
  `errorDeValidacion()` de [lib/core/validar.ts](lib/core/validar.ts): informa
  **todos** los problemas juntos y en castellano, no de a uno. Es para las rutas
  que no tienen validación propia. **Las que ya validan a mano no se tocan**: sus
  mensajes —"Falta quién lo pidió", "El ajuste no puede ser negativo"— son
  mejores que cualquier cosa genérica, y ésa es la vara. De 144 rutas que leen
  un cuerpo, las que no devolvían ni un 400 eran nueve; al 05/10/2026 quedan dos,
  y las dos se protegen bien a mano.
- **Una policy nueva llama a su función envuelta: `using ((select tiene_acceso_x()))`
  y no `using (tiene_acceso_x())`.** Postgres evalúa el `USING` **una vez por
  fila** aunque la función sea `STABLE`; el subselect lo convierte en un
  InitPlan que se evalúa una sola vez. Escribirla pelada no rompe nada y no
  avisa: esa tabla simplemente empieza a costar proporcional a sus filas —pedir
  50 cuesta como leerlas todas— y se nota recién cuando crece. El 14/10/2026
  eso tenía a `calculos_diarios` **en timeout** y a `cantera_pesadas` en 6,5
  segundos; después de envolver las 249 policies, todo quedó entre ×1,0 y ×1,3
  contra la misma consulta sin RLS. Las migraciones son `20261014090512` y
  `20261014104956`, y el porqué medido está en sus encabezados.
  - Se comprueba con `node scripts/medir-rls.mjs` (mide) y
    `node scripts/simular-rls.mjs` (dice qué cambiaría, sin tocar nada).
  - **La excepción**: una función que **recibe una columna de la fila**
    —`es_mi_hoja_ruta(hoja_ruta_id)`— no se envuelve nunca. Depende de la fila,
    así que evaluarla una sola vez le mostraría a cada uno los asientos del
    primero. Son 4 policies y es el único error de este tema que es un agujero
    de permisos y no una lentitud.
  - Y la trampa que ya mordió: **el filtro no es "sin argumentos"**.
    `mant_puede_ver(uid uuid DEFAULT auth.uid())` declara uno, se llama con
    `()` y hay que envolverla. Lo que decide es que la llamada tenga los
    paréntesis vacíos, no lo que diga `pronargs` — buscar por `pronargs = 0`
    dejó 22 policies de Mantenimiento afuera en la primera pasada.
- **En un Server Component `cookies().set()` no hace nada.** El canje del
  `?code=` de los correos va en un Route Handler.

## Las planillas de Google

**Compras, Mantenimiento e Inventario** espejan planillas de Sheets, y en
general **la planilla manda**: es de donde lee quien no entra al sistema. (RRHH
importa archivos de Excel, que es otra cosa: una carga puntual, no un espejo. Y
Remises no tiene planilla.)

**Acordado el 19/10/2026 y sin empezar: esto se va a dar vuelta.** Los cinco
espejos donde hoy manda la planilla pasan a que **los llene el sistema**, con
la planilla bloqueada para edición y una bajada semanal del último estado. El
orden, las cuatro trampas y por qué esta vez no repite las 800 toneladas de
carbonilla están en
[el spec](docs/superpowers/specs/2026-10-19-las-planillas-las-llena-el-sistema-design.md).
Hasta que eso esté hecho, lo que sigue abajo es lo que vale.

**Producción es la excepción, y conviene saberlo antes de tocarlo:** también
escribe una planilla, pero ahí **manda el sistema**. Calidad carga en el SdG y la
planilla quedó como el lugar donde miran los que no entran — una exportación de
una sola dirección, que el SdG nunca vuelve a leer. El riesgo asumido está
escrito en [docs/PRODUCCION.md](docs/PRODUCCION.md): si alguien la edita a mano,
el SdG no se entera y la pisa.

**En los dos frentes de Calidad que tienen planilla manda la planilla, y hay un
tercero que no tiene ninguna.** La raíz `/calidad` es un **tablero** con las tres
mitades como tarjetas; el stock de carbonilla, que vivía ahí, se mudó a
`/calidad/carbonilla` el 13/10/2026. En **Envases** (`/calidad/envases`, el stock
de bolsas y bolsones) manda la planilla como en Compras, Mantenimiento e
Inventario: es la planilla del almacén clonada, su stock es una fórmula sobre el
kardex, y un movimiento cargado en la app que no llega allá **no existe** — la
próxima sincronización lo borra de hecho. En **carbonilla** manda desde el
13/10/2026, cuando se dio vuelta: nació con Odoo como fuente de las entradas y
eso **necesitaba que alguien cambiara de costumbre**, así que mientras Calidad
siguió descargando los consumos en la planilla el número estuvo mal sin avisar —
925 toneladas de consumo y once camiones que el SdG no veía. Hoy el libro entero
sale de la planilla y Odoo quedó controlando, en `/calidad/conciliacion`: dice
qué camión entró sin orden de compra. Lo que evita el lazo ahí **no es
`sheets_fila` sino el id del movimiento, escrito en la columna `K`** de la
planilla; el número de fila no servía porque se insertan filas en el medio. Y en
**Ensayos** (`/calidad/ensayos`, las muestras del laboratorio) **no hay planilla
ninguna**: el SdG es el único lugar, así que ahí no existen `sheets_fila` ni
`sheets_pendiente` — ver [docs/CALIDAD-ENSAYOS.md](docs/CALIDAD-ENSAYOS.md).

Cinco reglas que costaron caro, y que valen para las cuatro:

- **Toda ruta que toque un campo que se exporta tiene que exportar**, y si no
  puede, dejar el pendiente anotado (`sheets_pendiente`). Cambiar un estado sin
  escribirlo en la planilla es una divergencia que no avisa.
- **Un fallo de escritura nunca es un `console.warn`.** Se guarda con **lo que
  dijo Google, sin traducir**, y se le dice a quien hizo la acción. Un
  diagnóstico que no se distingue de otro no es un diagnóstico: eso costó una
  tarde entera.
- **Las fechas van en d/m, no en m/d.** Leerlo al revés dio vuelta 885 fechas en
  Compras. Usar `fechaDeSheets()`, que vive en `lib/core/fechaDeSheets.ts` desde
  que la necesitó el tercer módulo.
- **Una planilla que está calculando no se lee ni se escribe.** Cuando sus
  fórmulas se recalculan, Google devuelve `Cargando…` en unas celdas y **vacías
  las demás** — y eso es indistinguible de una planilla sin datos. El 13/10/2026
  una OT nueva fue a parar a la fila 3, encima de la 623, porque la lectura de
  la columna A devolvió dos filas y la cuenta de "la primera libre" fue correcta
  sobre datos que no eran datos. `leerValores()` ahora corta solo; si alguien
  arma su propia lectura, tiene que usar `estaCalculando()` de
  `lib/core/sheets.ts`. Importar en ese estado es peor y más silencioso que
  escribir: las filas cuya primera columna sí resolvió entran con el resto
  vacío y pisan lo que había.
- **Al escribir, nada va como texto.** Las dos funciones de escritura usan
  `USER_ENTERED`, así que un `"19,58"` lo interpreta la planilla según su locale
  — la misma trampa que la anterior, por el otro lado. La fecha va como serial
  con `serialDelDia()` y los números como número; `escribirCeldas()` y
  `agregarFila()` aceptan los dos tipos. Un número no se interpreta.
- **Y al revés: el texto que tipea una persona sí va como texto.** Es la misma
  regla por el otro lado y se completó el 23/10/2026. `USER_ENTERED` convierte
  en fórmula lo que arranca con `=`, `+`, `-` o `@`, así que una descripción
  que diga `=IMPORTRANGE(...)` hace a mano lo que el 19/10/2026 dejó las once
  pestañas de Compras en blanco todo el día. Lo resuelve `textoParaLaCelda()`
  de [lib/core/sheets.ts](lib/core/sheets.ts) —un apóstrofo delante, que
  Google consume y no guarda— y hoy lo usan los once caminos de escritura.
  Lo que hay que saber antes de agregar el doceavo: **se aplica sólo a la
  prosa.** Un número, una hora, un serial de fecha o un id prefijados dejan de
  ser lo que son, y ahí la planilla deja de poder sumarlos — los horarios de
  Despacho alimentan `=F2-E2`. Medido el día que se puso: de 10.816 filas, cero
  tenían uno de esos caracteres, así que **nada se va a poner rojo el día que
  alguien lo saque**; el porqué está en el docstring de la función.
- **Antes de escribir una celda, comprobar el encabezado de esa columna.**
  `letraDeColumna()` es **0-based** —su primer renglón es `indice + 1`, así que
  el 0 es la A—, y el 21/10/2026 un script le pasó un `6` creyendo que era la F:
  escribió en la **G**, que en el libro de respuestas de OT es el equipo. Seis
  órdenes quedaron diciendo «EQUIPO: Planta filler 1». Lo que lo vuelve caro no
  es el off-by-one sino que **el script tenía al lado una constante `LETRA =
  "F"` sólo para imprimir**: el informe decía `...!F4` mientras la escritura iba
  a G, así que la pantalla confirmaba lo que no había pasado. Un rango que se
  arma por índice y se informa por letra son dos fuentes de verdad.
  Se recuperó porque el derrame del master —sus columnas A a J son un
  `QUERY(IMPORTRANGE())`— recalculó **después** de la última sincronización, así
  que `ordenes_trabajo` todavía tenía el `equipo_raw` bueno y de ahí salieron los
  valores (`scripts/restaurar-equipo-de-seis-ot.mts`). Quince minutos más tarde
  no había de dónde sacarlos.
- **El libro de respuestas de OT tiene catorce columnas `EQUIPO QUE SOLICITA`,
  una por sector**, porque el formulario pregunta por el equipo **después** de
  elegir el sector: Cantera escribe en la G, Hidratación en la K, Molienda en la
  L, filler 1 en la M, Taller en la U. El master las junta, así que de ese lado
  se ve una sola columna. **El alta del SdG escribe siempre en la G**, la de
  Cantera; hoy funciona por esa unión, y conviene saberlo antes de tocar
  cualquiera de las dos puntas.
- **Lo que la planilla deja de tener, se borra** — desde el 18/10/2026, en las
  cuatro que espejan por número: OT, avisos, órdenes de servicio y los
  requerimientos de Compras. Antes sólo traían y pisaban, así que una fila que
  alguien sacaba de la planilla seguía viva para siempre y el espejo dejaba de
  ser un espejo sin avisar. Es un `DELETE` de verdad, decidido a pedido: borrar
  una OT se lleva en cascada sus notas, sus repuestos y **su aviso**, y deja en
  null el enlace de las ejecuciones y de los ítems de planificación diaria —el
  plan de un día ya pasado no se reescribe—. Qué cuelga de una tabla y qué le
  pasa al borrarla lo contesta `node scripts/que-cuelga-de.mjs <tabla>`, y
  conviene preguntárselo a él: varias tablas de Mantenimiento las creó un delta
  aplicado a mano, así que sus `on delete` no están en ninguna migración y
  deducirlos del código da mal.
  La decisión vive en [lib/core/borradoDeEspejo.ts](lib/core/borradoDeEspejo.ts),
  y lo que hay que saber antes de tocarla es que **sólo se borra aquello cuya
  ausencia prueba algo**: lo que la app escribió y todavía no exportó, y lo que
  nació después de la lectura, quedan. Hay un **freno** que corta si habría que
  borrar más de 50 filas o del 10% de la tabla —el 13/10/2026 una planilla
  recalculando devolvió 2 filas de 623, y eso se habría llevado 621 OT—, se
  levanta con `?confirmar_borrado=1` y **el cron no lo levanta nunca**. Y el
  registro de auditoría se escribe **antes** del borrado: si no entra, no se
  borra. Por eso el verbo `borrar` necesitó su migración (`20261018134754`).

**RRHH tiene además una integración por API con el reloj biométrico, que no es
una planilla** y donde **manda Lenox**: las marcaciones entran solas por un cron
diario y un botón, y el SdG lee y **nunca escribe del otro lado**. Se parece a
las planillas en una sola cosa, y es la regla que más importa: la sincronización
corre sola, así que **no pisa lo que una persona corrigió** — protege por día, y
si el reloj discrepa, avisa en vez de sobrescribir. El Excel quedó de respaldo.
Lo que hay que saber antes de tocarla (el límite de llamadas, que un `429` no se
reintenta) está en [docs/RRHH-ACTUALIZACION.md](docs/RRHH-ACTUALIZACION.md).

Y una de diseño que se repite en todo el sistema: **enlazar al que se le parece
es peor que dejar en null.** Cuando una planilla nombra algo en texto libre y no
se lo reconoce con certeza, el enlace queda vacío y se informa. Un enlace
equivocado no se nota nunca — el dato aparece en el lugar que no es.

## Un desplegable se escribe `<Select>`, no `<select>`

Desde el 02/10/2026 los 157 desplegables de 71 pantallas usan
[`components/Select.tsx`](components/Select.tsx). Se usa **igual que el nativo**
—mismas props, los `<option>` adentro— y decide solo: con menos de diez opciones
renderiza un `<select>` nativo de verdad (la rueda del sistema en el teléfono,
que es mejor que cualquier panel propio), y con diez o más abre un panel con
buscador que ignora acentos y acepta las palabras en cualquier orden.

**Escribir un `<select>` nativo a mano no rompe nada, y ése es el problema.** No
hay error, no hay test que lo note: esa pantalla simplemente queda sin buscador,
y la lista crece hasta que alguien tiene que recorrer 273 proveedores con la
rueda del mouse. El umbral no se elige por pantalla; lo decide el componente con
las opciones que le llegan, así que una lista que hoy tiene ocho y mañana doce se
arregla sola.

`MultiSelect` sigue siendo el de **varios** valores, para los filtros de los
listados. Los dos comparten el umbral y el comparador en `components/desplegables.ts`.

Quedan tres pantallas sin migrar, porque otra sesión las tenía tomadas en el
árbol: `cantera/destape/cargar`, `cantera/voladuras/[codigo]` y
`trituracion/partes`. El detalle está en
[el spec](docs/superpowers/specs/2026-10-02-desplegables-con-buscador-design.md).

## Y una grilla de tres columnas lleva breakpoint

Es la gemela exacta de la regla de arriba: **escribir `grid-cols-3` sin
breakpoint no rompe nada, y ése es el problema.** No hay error, no hay test que
lo note, `tsc` y el build pasan; esa pantalla simplemente queda inusable en el
teléfono y nadie se entera hasta que alguien la abre desde la cantera. Desde el
16/10/2026 el SdG se instala en el celular, así que eso ya le pasa a la mitad del
equipo.

El ancho útil es **343 px** —los 375 del teléfono menos los 32 de padding del
layout—, así que tres columnas quedan en 114 px cada una y ahí no entra una
etiqueta con su campo. Va `grid-cols-1 sm:grid-cols-3`. Dos columnas entran
—165 px— salvo que lleven un campo de texto con su rótulo, y eso es un juicio que
el escaneo no hace.

Lo detecta `node scripts/revisar-responsive.mjs`, que busca cuatro cosas: grillas
de tres o más columnas sin breakpoint, `w-[Npx]` y `min-w-[Npx]` mayores a 343, y
`<table>` sin un contenedor con scroll. El escaneo a mano del 16/10/2026 encontró
30 lugares que no entraban en 313 pantallas; el script es ese escaneo convertido
en código. **No ve la sintaxis arbitraria** (`grid-cols-[repeat(12,1fr)]`): esa
hay que medirla a mano.

## Y `className="input w-20"` no mide 20

La tercera de la misma familia, y ésta tampoco rompe nada. `.input` —y `.card`,
y los `.btn-*`— están declarados en `app/globals.css` **fuera de toda capa**,
mientras las utilidades de Tailwind v4 viven en `@layer utilities`. Entre una
regla sin capa y una con capa **gana siempre la que no tiene capa**, pase lo que
pase con la especificidad. Así que el `width: 100%` de `.input` le gana a
cualquier `w-*` que se le ponga al lado.

Se nota poco porque casi siempre el elemento puede encogerse y queda "ancho pero
entra", así que no se ve roto: se ve mal. **Se vuelve grave cuando el ancho va
con `shrink-0`**, porque entonces no cede: el 21/10/2026, en los renglones de
repuestos de la OT, el campo de cantidad medía **624 px —la fila entera— y el
del repuesto quedaba en 26 px, empujado afuera de la tarjeta**. Dos días
cargando repuestos sin ver lo que se escribía.

El arreglo es **poner el ancho en un `div` que envuelva al campo** y dejar que el
`input` llene ese envoltorio con su `width: 100%`. Está explicado en
[components/RepuestosDeLaOT.tsx](components/RepuestosDeLaOT.tsx), y el
21/10/2026 se arreglaron los tres lugares que tenían el ancho suelto, medidos
antes y después:

| Dónde | Declaraba | Medía | Mide |
|---|---|---|---|
| Repuestos de la OT | `w-20` (80) | 624 px, y tapaba al otro campo | 80 px |
| `administracion/usuarios` | `w-40` (160) | 300, 352 y 319 px — uno distinto por módulo | 160 px los doce |
| `mantenimiento/ejecuciones` | `w-32` (128) | 346 px para escribir "40" | 128 px |

`flex-1`, en cambio, sí funciona: no declara `width`, y en un ítem flex el
`flex-basis` manda sobre el ancho. Y `.card` con `max-w-*` también, porque
`.card` no declara ni `width` ni `max-width`: lo que choca es la **misma**
propiedad, no cualquier utilidad de tamaño.

## Un aviso nuevo sale por dos lados, y hay un tercero que se gana aparte

Desde el 18/10/2026 el SdG manda **un resumen diario por push**: una
notificación por persona con lo que tiene para mirar en sus módulos, a las 11:30
UTC (8:30 de Argentina), después del último sync. Cada uno las prende en **Mi
cuenta → Notificaciones**, y **por aparato** — la clave de `push_suscripciones`
es `(usuario_id, endpoint)`, así que el celular y la computadora son dos filas.

Lo que hay que saber antes de tocar un módulo: **si agregás un aviso a
`lib/home/avisos.ts`, va a la campana y al push**. Los dos salen de
`avisosDeUsuario()`, a propósito, para que no puedan decir cosas distintas. O
sea que un aviso mal calibrado ya no es una campanita de más: es una
notificación en el teléfono de alguien.

**Pero no dicen lo mismo: la campana muestra el stock y el push el
movimiento.** Desde el 18/10/2026 el resumen diario dice lo que **se movió**
desde el resumen anterior —«3 más · Órdenes de trabajo atrasadas»— y los
**lunes** manda los totales. El motivo está medido: contando stocks, el push de
mañana decía lo mismo que el de hoy. «Facturas en el buzón sin vincular: 1»
dijo lo mismo trece días; hay **un solo service en todo el sistema**, así que
«15 equipos sin service» no podía bajar; 19 de las 23 OT atrasadas tienen más
de una semana y la más vieja es del 11/12/2025. Y la prueba de que ya costó: de
13 personas, las dos únicas que probaron las notificaciones en serio tenían
**los 13 avisos descartados** cada una — descartar era la única defensa contra
un mensaje que se repite.

Tres cosas que no se deducen del código:

- **La `cantidad` de un aviso se compara contra la foto del día anterior**
  (`avisos_fotos`, que escribe el mismo cron al final de cada corrida). Si
  cambiás **qué cuenta** un aviso sin cambiarle el id, el día del cambio sale
  una novedad falsa del tamaño del salto. Id nuevo para conteo nuevo.
- **Los lunes son la red, no un extra.** Contando sólo movimiento, algo que
  dejó de moverse no se nombra nunca más — y hay una OT atrasada desde
  diciembre de 2025. Si sacás el recordatorio semanal, el depósito se pudre en
  silencio.
- **Un aviso con lista de responsables va a la lista.** `compras-por-aprobar`
  va a `compras_aprobadores` y no a todo el que vea Compras: medido, le llegaba
  a 6 personas y 3 no podían aprobar. Los administradores siguen recibiendo
  todo lo demás.

Y una trampa que no se deduce del código: **la `cantidad` de un aviso de ritmo
no cuenta cosas.** Es cuántos umbrales lleva el módulo sin cargarse, y existe
sólo para que descartarlo no lo traiga de vuelta mañana. Por eso el resumen los
imprime sin número — si no diría «9 · Trituración: hace 36 días que no se
carga». Está fijado con un test en `lib/home/resumenDeAvisos.test.ts`.

El diseño y lo que se verificó están en
[el spec de la app instalable](docs/superpowers/specs/2026-10-16-app-instalable-design.md),
que lleva las cuatro fases: instalar y verse bien (hecha), avisar (hecha), leer
sin señal y cargar sin señal (sin empezar).

**El tercer lado es el aviso al instante, y no se hereda: se pide a mano.**
Desde el 18/10/2026, cuando algo queda esperando la decisión de una persona
—hoy un requerimiento de compra y una orden de servicio— quien tiene que
decidir recibe un push en el momento, sin esperar al resumen. Lo manda
`avisarAQuienDecide()` de [lib/core/avisoAlInstante.ts](lib/core/avisoAlInstante.ts),
y lo importante es lo que **no** hace: **agregar un aviso a `lib/home/avisos.ts`
no lo vuelve instantáneo**. Eso se decide ahí, a mano, y pasando las tres
condiciones que el encabezado de ese archivo deja escritas:

1. hay una **persona nombrada** esperando —una lista concreta como
   `compras_aprobadores`, no "el módulo"—;
2. **nada avanza** hasta que decida;
3. **acaba de pasar** — un estado que lleva tres días igual no es noticia a
   ninguna hora, y para eso está el resumen.

Tres cosas más que no se deducen del código, y que son las que evitan que esto
termine en que alguien apague las notificaciones:

- **Una notificación por corrida, no una por ítem.** La sincronización de
  Compras trae mediana 2 y hasta 16 filas nuevas de una vez; una por ítem son
  picos de dieciséis pushes juntos, que es exactamente lo que el resumen diario
  evita. De ahí sale gratis el freno contra una pegada de 200 filas en la
  planilla.
- **Ventana 7:00–21:00 de Argentina, y fuera de ella no se encola nada.** El
  resumen de las 8:30 ya cuenta los `PENDIENTE` sin mirar cuándo entraron, así
  que el repesque existe sin código. Ojo: el cron de Compras corre 09:00 UTC,
  que son las 6 de la mañana de acá, y queda afuera a propósito.
- **El enganche va en la sincronización y no en la ruta de alta.** De los
  últimos 400 requerimientos, 397 entraron por la planilla y 3 por la app: el
  momento en que el SdG se entera de un pedido es el momento en que
  `importarDesdeSheets` lo inserta, que el webhook del Apps Script corre con
  cada edición.

El porqué medido de cada una está en
[el spec](docs/superpowers/specs/2026-10-18-avisos-al-instante-design.md), con
la lista de los candidatos que **no** pasan el filtro y por qué — que es lo que
permite decirle que no al próximo módulo que lo pida.

**El payload de un push es plano: `{title, body, url}`.** Es el `Aviso` de
[lib/core/webpush.ts](lib/core/webpush.ts) y lo mandan los tres emisores que
hay —el resumen diario, el aviso al instante y el de Remises—. La `url` va en
el primer nivel, no adentro de un `data`.

Esto parece un detalle y costó un mes de notificaciones que no llevaban a
ningún lado: el handler de `push` de `public/sw.js` guardaba `data: data.data`,
un nivel que nadie escribe, así que `event.notification.data` llegaba
`undefined` y **toda notificación abría el inicio** — el resumen diario y el
aviso de Remises incluidos. Se arregló el 18/10/2026 y lo que importa es por
qué no lo vio nadie:

- **El test inventaba la forma del payload.** Le pasaba al handler
  `{title, body, data: {url}}`, anidado, que ningún emisor produce. Afirmaba
  que el handler guarda lo que le den en `data.data`: cierto e inútil. La
  forma de un payload se copia del contrato, no se inventa en el test.
- **Los dos handlers por separado estaban bien.** El `push` guardaba *algo* y
  el `notificationclick` abría *lo que le dieran*. Lo roto era el empalme, y
  eso no lo prueba ningún test de a uno. Por eso ahora hay uno que arranca de
  un `Aviso` tal cual sale de `JSON.stringify` y sigue hasta el `openWindow`,
  pasándole al click exactamente lo que el push guardó.

Si tocás el payload de un lado, el test de punta a punta de
`lib/core/sw.test.ts` es el que tiene que seguir en verde.

**Y un arreglo a `public/sw.js` no llegaba a ningún aparato.** El archivo no
tenía `skipWaiting` ni `clients.claim`, así que un worker nuevo quedaba **en
espera** hasta que se cerraran todas las ventanas del dominio —con la app
instalada, eso puede no pasar en días— mientras el viejo seguía atendiendo los
push. Se desplegó el arreglo de arriba y el teléfono siguió cayendo en el
inicio: estaba servido y no corría. **Ningún arreglo hecho a ese archivo desde
la fase 1 había llegado nunca a un aparato con la app instalada**, y no se nota,
porque un worker en espera no se distingue de uno que funciona. Se agregó el
18/10/2026 y ahora cada versión toma el control sola.

Lo que hay que saber antes de tocarlo: **`skipWaiting` es seguro mientras ese
archivo no cachee nada.** Hoy el handler de `fetch` pasa derecho a la red. El
día que cachee —las fases 3 y 4—, un worker nuevo tomando el control a mitad de
sesión le puede servir a una página ya cargada los assets de otra versión. Por
eso mismo el `activate` **no borra cachés** y hay un test que lo fija: un
`activate` que borra es justo lo que vuelve peligroso a `skipWaiting`. La
advertencia completa está en el encabezado del propio `public/sw.js`.

## Cómo se verifica

```bash
npm test              # vitest — la lógica pura, que es donde están las decisiones
npx tsc --noEmit
npm run build
node scripts/revisar-arbol-commiteado.mjs   # antes de dar por buena una tarea
node scripts/revisar-responsive.mjs         # lo que no entra en un telefono de 375 px
npm run planillas                           # si alguna planilla se cayo por una formula
```

**`npm run planillas` es el único que no mira el código sino el dato del otro
lado**, y existe porque los otros cinco no podían ver lo que pasó dos veces en
una semana: el 13/10/2026 la planilla de OT estaba recalculando y una OT nueva
fue a parar encima de la 623, y el 19/10/2026 la de Compras pasó el día entera
en blanco porque `APROB COMPRAS` tenía 1.686 celdas importando **su propio
libro** —un lazo de `IMPORTRANGE` que no resuelve nunca—. Las once pestañas de
Compras se vaciaron a la vez, porque las diez por área son `FILTER` del master.
El código estaba bien las dos veces.

Lo difícil ahí no es leer la planilla: es **no sonar por lo que no importa**.
Hay miles de `#N/A` normales —2.420 en `APROB COMPRAS`, 1.659 en el
seguimiento— que son un `VLOOKUP` sobre una clave que no está, y llevan meses.
Por eso una caída pide **dos** condiciones juntas: una fórmula de las que
generan una región (`QUERY`, `FILTER`, `IMPORTRANGE`, `ARRAYFORMULA`) que
devuelve error, **y** la pestaña sin filas. La decisión vive en
[lib/core/saludDePlanilla.ts](lib/core/saludDePlanilla.ts), con las dos caídas
reales fijadas como tests; el script es sólo la lectura. Sale 1 si hay un
ROMPE, y hoy da **ROMPE 0 · MIRAR 21**.

Lo primero que encontró vale como ejemplo de qué buscar. En el libro
`Respuestas ORDEN DE TRABAJO` había una copia de la pestaña `OT` de la planilla
`ORDEN DE TRABAJO`, y al estar en el mismo libro que los datos, su
`IMPORTRANGE` había quedado apuntando a sí mismo — nadie escribió nada raro:
**se duplicó una pestaña y la URL, que nombraba al libro de respuestas, pasó a
nombrar su propio libro.** Esa copia además traía sólo `Respuestas de
formulario` y no `Altas del sistema`, así que le faltaban las OT que crea el
SdG: 2.200 de 2.203 el 19/10/2026, sin las 2822, 2823 y 2824. Se borró, y con
eso **no queda ninguna auto-importación en las once planillas**.

La moraleja para la próxima: duplicar una pestaña que tiene `IMPORTRANGE`
**crea el lazo sola**, sin que nadie escriba una fórmula mala.

Necesita `GOOGLE_SERVICE_ACCOUNT_JSON`, así que **no puede ir al CI** como está:
leer las planillas de producción desde un runner pide meter esa credencial ahí.

Y una defensa que ya existe y está apagada: `agregarFila()` de
`lib/core/sheets.ts` acepta `filaMasAltaConocida` y se niega a escribir si la
planilla devuelve menos filas de las que el sistema tiene anotadas
—`laPlanillaEncogio`, escrita justamente por lo del 13/10—. **Ninguno de los
nueve lugares que la llaman se lo pasa**, así que el valor por defecto es 0 y la
comprobación nunca se hace. Está así a propósito, para no cambiar el
comportamiento de los módulos de golpe; encenderla es pasarle el mayor
`sheets_row`/`sheets_fila` guardado, módulo por módulo.

**`revisar-arbol-commiteado` es el que atrapa lo que los otros tres no pueden.**
Los tres primeros miran **el disco**; Vercel construye **el árbol commiteado**, y en este repo esos
dos no son lo mismo: como suele haber otra sesión en el mismo árbol, se commitea
con rutas explícitas y a veces se pushea armando el árbol con plumbing, y las dos
cosas copian sólo lo que se nombra. Un archivo nuevo que quedó *staged* y nunca
se commiteó no viaja, mientras los que lo importan sí — y nada avisa, porque
`git push` confirma que la ref se movió, no que el árbol esté completo. Eso tiró
**cuatro deploys seguidos** el 14/09/2026 con un `Module not found` que el build
local no podía reproducir. El script resuelve todos los imports del árbol de git
contra sí mismo; sin argumento mira `origin/main`, y acepta una ref para revisar
otra cosa.

**Las primeras cuatro también corren solas** en cada push y en cada PR, desde
`.github/workflows/verificar.yml` (22/09/2026). Correrlas a mano sigue siendo lo
que conviene —el CI tarda minutos y avisa tarde—, pero ya no es lo único que hay:
antes, lo que decidía si un cambio estaba bien era que alguien se acordara.

**`revisar-responsive` es la quinta y todavía NO está en el CI**, por el mismo
motivo que el lint: los 5 calendarios del mes son falsos positivos conocidos y un
CI que está siempre rojo no lo mira nadie. Están en una lista de excepciones del
propio script, con el porqué; cuando esa lista esté estable se agrega el paso.
Mientras tanto sale 1 si hay algún ROMPE, y hoy da **ROMPE 0 · APRETADO 0 ·
MIRAR 0**: cualquier cosa que aparezca es de lo que uno acaba de escribir.

- **`next build` con `npm run dev` levantado deja la app en 500.** Parar el dev
  server antes.
- **Si cambiás `public/logo.png`, corré `node scripts/generar-iconos.mjs`.** Los
  íconos del manifest se commitean generados, así que un logo nuevo sin esa
  pasada deja la app instalada con el ícono viejo y **nada avisa**: ni el build,
  ni los tests, ni el navegador.
- `npm run lint` **casi pasa**. Desde `a7fd2f1` hay `eslint.config.mjs` y el
  lint corre; el 05/10/2026 se cerraron 20 de los 23 errores que quedaban —los
  `react-hooks/set-state-in-effect` pasaron a `useCargar` o a ajustarse durante
  el render, y las comillas sueltas en JSX se escaparon—. **Quedan 3**, en
  `cantera/acarreo/AcarreoClient.tsx` y `facturacion/buzon/LineasDeFactura.tsx`,
  que estaban abiertos en otra sesión ese día y no se tocaron: arreglarlos
  habría sido pisarle el trabajo.
  Por eso el lint **todavía no** está en el CI: con un error rojo, un CI que
  está siempre rojo no lo mira nadie. Cuando esos 3 se cierren, se agrega el
  paso y el lint empieza a defender algo.
- **El tamaño de la suite, medido el 08/10/2026 sin worktrees abiertos: 215
  archivos y 3.004 tests.** Los 95 archivos y 1.357 tests que menciona el
  comentario de `vitest.config.mts` no son un error: son de cuando se midió el
  problema de abajo, y ahí dicen lo que tienen que decir. El número de hoy
  cambia con cada tarea, así que si importa, correr `npm test`.
- **Los worktrees de Claude Code viven adentro del repo** (`.claude/worktrees/`),
  así que vitest los recorría como código del proyecto y recogía cada
  `*.test.ts` una vez por worktree abierto — con dos abiertos, la suite corría
  tres veces lo mismo. Nada rompía, pero el número dejaba de significar algo y
  esas copias corrían contra el código del worktree, así que un verde podía
  estar tapando que el árbol principal estaba rojo. Ya está excluido en
  `vitest.config.mts` (el comentario de ahí tiene los números); lo que hay que
  saber es que **si tocás ese `exclude`, `configDefaults.exclude` va sí o sí**:
  definirlo pisa el default de vitest en vez de sumarse, y sin él se cuelan dos
  archivos de test que vienen en `node_modules` — medido, no teórico. `tsc` no
  tiene el problema: TypeScript ignora los directorios que empiezan con punto,
  así que `--listFilesOnly` en el árbol principal no trae ni un archivo de
  `.claude/worktrees/`. No hay nada que arreglar en `tsconfig.json`.
  **ESLint sí tenía el mismo problema** y se arregló el 22/09/2026: con un
  worktree abierto contaba seis errores duplicados y 1.900 avisos de más, y de
  paso linteaba el pdf.js minificado de `public/pdfjs/`. Las dos entradas están
  ahora en el `ignores` de `eslint.config.mjs`; con un worktree abierto el lint
  pasó de 2.276 problemas a 359 sin que se arreglara una sola línea de código.
- **Casi todo está detrás del login**, así que no se puede comprobar en el
  navegador. Se verifica con tests sobre las funciones puras y, cuando hace falta
  ver datos reales, consultando la base con el `SUPABASE_SERVICE_ROLE_KEY` de
  `.env.local`.
- Las credenciales de Google **sí están en local** (`GOOGLE_SERVICE_ACCOUNT_JSON`
  en `.env.local`), así que leer una planilla real desde acá funciona y conviene
  usarlo: es la diferencia entre razonar sobre lo que la planilla "debería" tener
  y medirlo. Despacho se diseñó con dos supuestos sobre su libro y los dos eran
  falsos. Lo que falta por planilla es su id — los que hay están en
  [docs/VARIABLES-VERCEL.md](docs/VARIABLES-VERCEL.md). **Leer sí; escribir es la
  planilla de producción.**

## Qué se testea

Vitest sobre **funciones puras**: parseo de planillas, cálculos, permisos,
filtros. Las rutas y las pantallas no tienen tests, así que la lógica que
importa se saca de la ruta a `lib/` para poder probarla — es lo que hizo
`repartirRegistroDeOT` después de que un campo se colara del lado equivocado sin
que nada lo notara.

## Commits

Conventional commits en castellano: `feat(compras): …`, `fix(mantenimiento): …`.
El cuerpo explica **por qué**, no qué: qué problema resuelve, qué se probó antes,
y qué riesgo queda asumido. Es la misma vara que los comentarios del código y la
razón por la que este repo se puede retomar meses después.

Se trabaja sobre `main` y se pushea al terminar cada tarea.
