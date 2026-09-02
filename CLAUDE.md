# SdG — Sistema de Gestión (Polcecal / Polysan)

Un ERP que unifica en una sola app lo que eran tres, sobre un núcleo de datos
compartido. **Next.js 16 + Supabase, desplegado en Vercel.** En producción:
https://sistema-integral-one.vercel.app

Cinco módulos: **RRHH** (con **Remises** como submódulo), **Mantenimiento**,
**Compras** e **Inventario**. Cada uno vive en `app/(app)/<modulo>`,
`lib/<modulo>` y `app/api/<modulo>`.

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

Antes de escribir una, leer las cuatro trampas del
[README de migraciones](supabase/migrations/README.md). Dos de ellas ya pasaron
**dos veces**:

- Un valor de enum nuevo **viaja solo** en su propio archivo (`55P04`).
- Un **índice parcial no sirve** como destino de `ON CONFLICT`.

## Reglas de la base que muerden

- **PostgREST corta en 1000 filas y no avisa**: `.limit(3000)` devuelve 1000.
  Usar `traerTodo()` de `lib/core/paginado.ts` en cualquier tabla que pueda
  crecer. No razonar "esta tabla es chica": el tablero de Compras parecía una
  cola acotada y arrastra 1.900 filas.
- **Un `.in()` con muchos ids** arma una URL que PostgREST rechaza con un 400 sin
  decir por qué. Filtrar por una condición, o de a lotes de 200.
- **Un `select()` armado en una variable** pierde la inferencia de tipos de
  Supabase. La cadena va literal.
- **Los catálogos del núcleo los comparten los cinco módulos**: `usuarios`,
  `sectores`, `equipos`, `empleados`, `proveedores`. Se leen; no se borran ni se
  rehacen desde un módulo.
- **En un Server Component `cookies().set()` no hace nada.** El canje del
  `?code=` de los correos va en un Route Handler.

## Las planillas de Google

**Compras, Mantenimiento e Inventario** espejan planillas de Sheets, y en
general **la planilla manda**: es de donde lee quien no entra al sistema. (RRHH
importa archivos de Excel, que es otra cosa: una carga puntual, no un espejo. Y
Remises no tiene planilla.) Tres reglas que costaron caro:

- **Toda ruta que toque un campo que se exporta tiene que exportar**, y si no
  puede, dejar el pendiente anotado (`sheets_pendiente`). Cambiar un estado sin
  escribirlo en la planilla es una divergencia que no avisa.
- **Un fallo de escritura nunca es un `console.warn`.** Se guarda con **lo que
  dijo Google, sin traducir**, y se le dice a quien hizo la acción. Un
  diagnóstico que no se distingue de otro no es un diagnóstico: eso costó una
  tarde entera.
- **Las fechas van en d/m, no en m/d.** Leerlo al revés dio vuelta 885 fechas en
  Compras. Usar `fechaDeSheets()`.

Y una de diseño que se repite en todo el sistema: **enlazar al que se le parece
es peor que dejar en null.** Cuando una planilla nombra algo en texto libre y no
se lo reconoce con certeza, el enlace queda vacío y se informa. Un enlace
equivocado no se nota nunca — el dato aparece en el lugar que no es.

## Cómo se verifica

```bash
npm test              # vitest — la lógica pura, que es donde están las decisiones
npx tsc --noEmit
npm run build
```

- **`next build` con `npm run dev` levantado deja la app en 500.** Parar el dev
  server antes.
- `npm run lint` **falla**: el repo no tiene config de ESLint. No es tu cambio.
- **Casi todo está detrás del login**, así que no se puede comprobar en el
  navegador. Se verifica con tests sobre las funciones puras y, cuando hace falta
  ver datos reales, consultando la base con el `SUPABASE_SERVICE_ROLE_KEY` de
  `.env.local`.
- Las credenciales de Google **no están en local**: leer o escribir una planilla
  sólo funciona en el deploy.

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
