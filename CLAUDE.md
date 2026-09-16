# SdG — Sistema de Gestión (Polcecal / Polysan)

Un ERP que unifica en una sola app lo que eran tres, sobre un núcleo de datos
compartido. **Next.js 16 + Supabase, desplegado en Vercel.** En producción:
https://sistema-integral-one.vercel.app

Diez módulos: **RRHH** (con **Remises** como submódulo), **Mantenimiento**,
**Compras**, **Inventario**, **Producción**, **Despacho**, **Facturación**,
**Cantera** y **Calidad**. Cada uno vive en `app/(app)/<modulo>`, `lib/<modulo>`
y `app/api/<modulo>`.

**Producción y Calidad son dos cosas distintas y se confunden fácil**, porque las
carga la misma gente: Producción es el parte de fábrica por turno, y Calidad es
lo que ese sector lleva aparte —el stock de envases y el de carbonilla—.

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
| Mantenimiento | [docs/MANTENIMIENTO-INTEGRACION.md](docs/MANTENIMIENTO-INTEGRACION.md) |
| RRHH | [docs/RRHH-ACTUALIZACION.md](docs/RRHH-ACTUALIZACION.md) |
| Inventario | los tres specs de `docs/superpowers/specs/2026-09-02-inventario-*` |
| Producción | [docs/PRODUCCION.md](docs/PRODUCCION.md) · [spec](docs/superpowers/specs/2026-09-07-produccion-design.md) |
| Despacho | [docs/DESPACHO.md](docs/DESPACHO.md) · [spec](docs/superpowers/specs/2026-09-08-despacho-ordenes-de-carga-design.md) |
| Calidad | envases: [docs/CALIDAD-ENVASES.md](docs/CALIDAD-ENVASES.md) · [spec](docs/superpowers/specs/2026-09-15-produccion-envases-design.md) · [plan](docs/superpowers/plans/2026-09-15-produccion-envases.md) — carbonilla: [docs/CALIDAD.md](docs/CALIDAD.md) · [spec](docs/superpowers/specs/2026-09-16-calidad-stock-de-carbonilla-design.md) · [plan](docs/superpowers/plans/2026-09-16-calidad-stock-de-carbonilla.md) |
| Facturación | [docs/FACTURACION.md](docs/FACTURACION.md) · [spec](docs/superpowers/specs/2026-09-04-facturacion-proveedores-odoo-design.md) |
| Odoo | [docs/ODOO-INTEGRACION.md](docs/ODOO-INTEGRACION.md) |
| Login y correos | [docs/AUTENTICACION.md](docs/AUTENTICACION.md) |
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
- **En un Server Component `cookies().set()` no hace nada.** El canje del
  `?code=` de los correos va en un Route Handler.

## Las planillas de Google

**Compras, Mantenimiento e Inventario** espejan planillas de Sheets, y en
general **la planilla manda**: es de donde lee quien no entra al sistema. (RRHH
importa archivos de Excel, que es otra cosa: una carga puntual, no un espejo. Y
Remises no tiene planilla.)

**Producción es la excepción, y conviene saberlo antes de tocarlo:** también
escribe una planilla, pero ahí **manda el sistema**. Calidad carga en el SdG y la
planilla quedó como el lugar donde miran los que no entran — una exportación de
una sola dirección, que el SdG nunca vuelve a leer. El riesgo asumido está
escrito en [docs/PRODUCCION.md](docs/PRODUCCION.md): si alguien la edita a mano,
el SdG no se entera y la pisa.

**Calidad tiene las dos direcciones a la vez**, así que conviene mirar en qué
mitad del módulo se está parado antes de tocar una ruta. En **Envases**
(`/calidad/envases`, el stock de bolsas y bolsones) **manda la planilla**, como
en Compras, Mantenimiento e Inventario: es la planilla del almacén clonada, su
stock es una fórmula sobre el kardex, y un movimiento cargado en la app que no
llega allá **no existe** — la próxima sincronización lo borra de hecho. En
**carbonilla**, en cambio, la planilla se va: las entradas salen de Odoo y de la
balanza.

Tres reglas que costaron caro, y que valen para las cuatro:

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
- **Al escribir, nada va como texto.** Las dos funciones de escritura usan
  `USER_ENTERED`, así que un `"19,58"` lo interpreta la planilla según su locale
  — la misma trampa que la anterior, por el otro lado. La fecha va como serial
  con `serialDelDia()` y los números como número; `escribirCeldas()` y
  `agregarFila()` aceptan los dos tipos. Un número no se interpreta.

Y una de diseño que se repite en todo el sistema: **enlazar al que se le parece
es peor que dejar en null.** Cuando una planilla nombra algo en texto libre y no
se lo reconoce con certeza, el enlace queda vacío y se informa. Un enlace
equivocado no se nota nunca — el dato aparece en el lugar que no es.

## Cómo se verifica

```bash
npm test              # vitest — la lógica pura, que es donde están las decisiones
npx tsc --noEmit
npm run build
node scripts/revisar-arbol-commiteado.mjs   # antes de dar por buena una tarea
```

**El último es el que atrapa lo que los otros tres no pueden.** Los tres primeros
miran **el disco**; Vercel construye **el árbol commiteado**, y en este repo esos
dos no son lo mismo: como suele haber otra sesión en el mismo árbol, se commitea
con rutas explícitas y a veces se pushea armando el árbol con plumbing, y las dos
cosas copian sólo lo que se nombra. Un archivo nuevo que quedó *staged* y nunca
se commiteó no viaja, mientras los que lo importan sí — y nada avisa, porque
`git push` confirma que la ref se movió, no que el árbol esté completo. Eso tiró
**cuatro deploys seguidos** el 14/09/2026 con un `Module not found` que el build
local no podía reproducir. El script resuelve todos los imports del árbol de git
contra sí mismo; sin argumento mira `origin/main`, y acepta una ref para revisar
otra cosa.

- **`next build` con `npm run dev` levantado deja la app en 500.** Parar el dev
  server antes.
- `npm run lint` **falla**: el repo no tiene config de ESLint. No es tu cambio.
- **Los worktrees de Claude Code viven adentro del repo** (`.claude/worktrees/`),
  así que vitest los recorría como código del proyecto y recogía cada
  `*.test.ts` una vez por worktree abierto — con dos abiertos, la suite corría
  tres veces lo mismo. Nada rompía, pero el número dejaba de significar algo y
  esas copias corrían contra el código del worktree, así que un verde podía
  estar tapando que el árbol principal estaba rojo. Ya está excluido en
  `vitest.config.ts` (el comentario de ahí tiene los números); lo que hay que
  saber es que **si tocás ese `exclude`, `configDefaults.exclude` va sí o sí**:
  definirlo pisa el default de vitest en vez de sumarse, y sin él se cuelan dos
  archivos de test que vienen en `node_modules` — medido, no teórico. `tsc` no
  tiene el problema: TypeScript ignora los directorios que empiezan con punto,
  así que `--listFilesOnly` en el árbol principal no trae ni un archivo de
  `.claude/worktrees/`. No hay nada que arreglar en `tsconfig.json`.
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
