# Reprogramación de OT y pantalla de Análisis — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que cada corrimiento de la fecha de inicio de una OT quede guardado como dato consultable, que el listado lo muestre, y que una pantalla nueva de Análisis conteste por semana lo que hoy contesta la hoja `Analisis de OT`.

**Architecture:** una tabla `mant_reprogramaciones_ot` con una fila por movimiento, escrita por dos caminos —la ruta `postergar` (origen `sistema`) y la sincronización de OT (origen `planilla`, sólo sobre órdenes abiertas)—; un contador en `ordenes_trabajo` mantenido por trigger para poder filtrar sobre las 2.531; y toda la aritmética —la semana, los seis números, la cadena— en `lib/mantenimiento/` con tests, porque las rutas y las pantallas de este repo no los tienen.

**Tech Stack:** Next.js 16 (App Router), Supabase/PostgREST, TypeScript, vitest, Tailwind v4.

**Spec:** [docs/superpowers/specs/2026-11-19-mantenimiento-reprogramacion-y-analisis-de-ot-design.md](../specs/2026-11-19-mantenimiento-reprogramacion-y-analisis-de-ot-design.md)

## Global Constraints

- Todo en **castellano**: nombres, comentarios, textos de pantalla y de commit.
- **La migración la corre una persona a mano** en el editor SQL de Supabase. Ningún paso de este plan aplica DDL. La tarea 1 termina esperando.
- **Nunca `git add -A`**: hay otra sesión en el mismo árbol. Cada commit nombra sus archivos.
- La migración se crea con `npm run migracion "descripcion corta"` (marca de tiempo, no contador).
- Una policy nueva va envuelta: `using ((select mant_puede_ver()))`, nunca pelada.
- Un `select()` va literal, no armado en una variable.
- `traerTodo()` de `lib/core/paginado.ts` en cualquier lectura que pueda crecer; PostgREST corta en 1000 sin avisar.
- Un desplegable se escribe `<Select>`. Una grilla de tres o más columnas lleva breakpoint: `grid-cols-1 sm:grid-cols-3`. Un ancho al lado de `.input` va en un `div` que lo envuelva, nunca como `w-*` sobre el `input`.
- **«Abierta» es `estado` fuera de `["REALIZADO", "CANCELADA"]`**, nunca `fecha_cierre is null`, y nunca el valor `ATRASADO`.
- Ningún test afirma un número leído de producción: los fixtures van congelados en el test.
- Verificación: `npm test`, `npx tsc --noEmit`, `npm run build`, `node scripts/revisar-arbol-commiteado.mjs`, `node scripts/revisar-responsive.mjs`. Si `tsc` se queda sin heap: `node --max-old-space-size=8192 ./node_modules/typescript/bin/tsc --noEmit`.

## Review Focus

Cinco cosas que el diseño implica y que ninguna tarea ejercitaría sola. Cada una tiene su test agregado a la tarea que la posee.

1. **Una OT que no tenía fecha de inicio y recibe una** no es una reprogramación: `fecha_anterior` nula no genera fila. Sin esto, la primera sincronización después de la migración inventaría una reprogramación por cada OT sin fecha. → Tarea 4.
2. **Una fecha que se mueve hacia atrás** (la nueva es anterior a la vigente) tiene que registrarse igual y dar días negativos sin romper el total. → Tarea 2.
3. **Una semana sin ninguna OT con inicio** hace que el cumplimiento divida por cero. Tiene que decir «—» y no `NaN%` ni `Infinity`. → Tarea 7.
4. **Una OT cuya fecha de cierre es anterior a su fecha de inicio** existe de verdad (2 en la semana 45) y cae en «cerraron antes del lunes»; no puede contarse además como «cerró fuera de fecha». → Tarea 7.
5. **Una fila de origen `planilla` llega sin razón, sin justificación y sin autor.** La pantalla tiene que decir «cambiada en la planilla» y no renderizar `null`, comillas vacías ni «undefined». → Tarea 9.

---

### Task 1: La migración

**Files:**
- Create: `supabase/migrations/<marca>_reprogramaciones_de_ot.sql` (el nombre lo genera `npm run migracion`)
- Create: `scripts/comprobar-reprogramaciones.mts`

**Interfaces:**
- Consumes: nada.
- Produces: la tabla `public.mant_reprogramaciones_ot` con las columnas `id uuid pk default gen_random_uuid()`, `ot_id uuid not null references public.ordenes_trabajo(id) on delete cascade`, `fecha_anterior date`, `fecha_nueva date not null`, `origen text not null check (origen in ('sistema','planilla'))`, `razon text`, `razon_etiqueta text`, `justificacion text`, `creado_por uuid references public.usuarios(id)`, `creado_en timestamptz not null default now()`. Y la columna `public.ordenes_trabajo.reprogramada_veces integer not null default 0`.

- [ ] **Step 1: Crear el archivo con `npm run migracion "reprogramaciones de ot"`**

- [ ] **Step 2: Escribir la migración**

En este orden: la tabla; un índice `(ot_id, creado_en desc)` —que es como se lee siempre, la última fila de una OT— y otro sobre `creado_en` para la pestaña semanal; la columna `reprogramada_veces` en `ordenes_trabajo`; una función `public.mant_contar_reprogramaciones()` y un trigger `after insert or delete` sobre `mant_reprogramaciones_ot` que la mantiene; `enable row level security`; una policy de `select` para `authenticated` con `using ((select mant_puede_ver()))` y ninguna de insert/update/delete, porque escribe sólo el cliente admin de las rutas.

El encabezado del archivo explica, en castellano: por qué el contador va por trigger y no por código de la aplicación, y por qué `razon` no lleva foreign key y la etiqueta se copia (las dos razones están en el spec).

**`razon` no lleva FK a `mant_razones_de_postergacion`.**

- [ ] **Step 3: Escribir el comprobador**

`scripts/comprobar-reprogramaciones.mts`: lee `.env.local`, y con el cliente admin comprueba por PostgREST que la tabla responde, que `ordenes_trabajo.reprogramada_veces` existe, e inserta y borra una fila de prueba sobre una OT real verificando que el contador sube a 1 y vuelve a 0. Imprime qué comprobó. Sale 1 si algo falta.

- [ ] **Step 4: Pedirle al usuario que la corra y esperar**

Decirle el nombre del archivo y que va en el editor SQL de Supabase. **No seguir hasta que confirme.**

- [ ] **Step 5: Comprobar que quedó aplicada**

Run: `npx tsx scripts/comprobar-reprogramaciones.mts`
Expected: imprime las tres comprobaciones en verde y sale 0.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/*_reprogramaciones_de_ot.sql scripts/comprobar-reprogramaciones.mts
git commit -m "feat(mantenimiento): la tabla donde vive el historial de reprogramaciones"
```

---

### Task 2: La cadena de fechas y la cuenta de días

**Files:**
- Create: `lib/mantenimiento/reprogramaciones.ts`
- Test: `lib/mantenimiento/reprogramaciones.test.ts`

**Interfaces:**
- Consumes: `sumarDias`, `comoSeLee` de `lib/core/fechas.ts`.
- Produces:
  - `export interface Reprogramacion { id: string; ot_id: string; fecha_anterior: string | null; fecha_nueva: string; origen: "sistema" | "planilla"; razon: string | null; razon_etiqueta: string | null; justificacion: string | null; creado_por: string | null; creado_en: string; }`
  - `export function cadenaDeFechas(movimientos: readonly Reprogramacion[], fechaVigente: string | null): string[]` — las fechas en orden, de la original a la vigente, sin repetir.
  - `export function diasCorridos(movimientos: readonly Reprogramacion[], fechaVigente: string | null): number` — días entre la primera fecha de la cadena y la vigente.
  - `export function diasDelMovimiento(m: Reprogramacion): number | null` — null si `fecha_anterior` es null.

- [ ] **Step 1: Escribir los tests que fallan**

En `lib/mantenimiento/reprogramaciones.test.ts`, con movimientos construidos a mano en el propio archivo:

```ts
describe("cadenaDeFechas", () => {
  it("con un movimiento da las dos fechas", /* ["2026-11-06","2026-11-13"] */);
  it("con tres movimientos encadena las cuatro y no repite", /* 06,13,20,27 */);
  it("sin movimientos da sólo la vigente", /* ["2026-11-27"] */);
  it("sin movimientos y sin fecha vigente da la lista vacía", /* [] */);
  it("ignora un fecha_anterior nulo al principio de la cadena", /* arranca en fecha_nueva */);
  it("termina en la fecha vigente aunque no sea la del último movimiento",
     /* la sincronización la movió después: la vigente va al final igual */);
});

describe("diasCorridos", () => {
  it("suma los tres tramos de una cadena de tres", /* 21 */);
  it("da negativo si la fecha se movió hacia atrás", /* -4 */);   // Review Focus 2
  it("da 0 sin movimientos");
});

describe("diasDelMovimiento", () => {
  it("da los días entre las dos fechas", /* 7 */);
  it("da null si no hay fecha anterior");
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/mantenimiento/reprogramaciones.test.ts`
Expected: FAIL, no existe el módulo.

- [ ] **Step 3: Escribir `lib/mantenimiento/reprogramaciones.ts`**

Los movimientos llegan ordenados por `creado_en` ascendente; la función no reordena y lo dice en su docstring. El encabezado del archivo explica por qué la cadena termina en la fecha vigente y no en el último `fecha_nueva`: entre el movimiento y la lectura puede haber entrado una sincronización.

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run lib/mantenimiento/reprogramaciones.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/mantenimiento/reprogramaciones.ts lib/mantenimiento/reprogramaciones.test.ts
git commit -m "feat(mantenimiento): la cadena de fechas de una OT reprogramada"
```

---

### Task 3: Postergar escribe su fila

**Files:**
- Modify: `lib/mantenimiento/reprogramaciones.ts`
- Modify: `app/api/mantenimiento/ordenes/[id]/postergar/route.ts`
- Test: `lib/mantenimiento/reprogramaciones.test.ts`

**Interfaces:**
- Consumes: `Reprogramacion` de la tarea 2; `mant_razones_de_postergacion` tal como la lee hoy `PostergarOTModal`.
- Produces: `export function filaDeReprogramacionDelSistema(p: { otId: string; fechaAnterior: string | null; fechaNueva: string; razon: string; razonEtiqueta: string | null; justificacion: string; usuarioId: string }): Record<string, unknown>`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
describe("filaDeReprogramacionDelSistema", () => {
  it("lleva origen 'sistema'");
  it("copia la etiqueta de la razón además del código");
  it("deja razon_etiqueta en null si la razón ya no existe");
  it("recorta los espacios de la justificación");
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/mantenimiento/reprogramaciones.test.ts -t filaDeReprogramacionDelSistema`
Expected: FAIL

- [ ] **Step 3: Implementar la función y engancharla en la ruta**

En la ruta, el insert va **junto al `update` de `fecha_ejecucion`** —después de que la escritura a la planilla salió bien, o sea después del `corregirLaFechaComprometida` que hoy devuelve 502 sin traducir si falla— y **antes** de la nota y de `auditar()`. La etiqueta se lee de `mant_razones_de_postergacion` por su `codigo`. La fila de `auditoria` que la ruta ya escribe **no se toca**: son dos registros distintos y el spec dice por qué.

Si el insert del historial falla, la ruta devuelve el error: a diferencia del camino de la sincronización, acá hay una persona mirando y la postergación ya se escribió en la planilla, así que un historial que falta en silencio es peor que un cartel.

- [ ] **Step 4: Correr los tests**

Run: `npx vitest run lib/mantenimiento/reprogramaciones.test.ts`
Expected: PASS

- [ ] **Step 5: Comprobar contra la base**

Postergar una OT de prueba `app_created` desde la pantalla y verificar con el comprobador de la tarea 1 que quedó una fila con `origen='sistema'` y que `reprogramada_veces` subió a 1.

- [ ] **Step 6: Commit**

```bash
git add lib/mantenimiento/reprogramaciones.ts lib/mantenimiento/reprogramaciones.test.ts "app/api/mantenimiento/ordenes/[id]/postergar/route.ts"
git commit -m "feat(mantenimiento): postergar deja el movimiento como dato y no solo como efecto"
```

---

### Task 4: La sincronización registra lo que se cambió en la planilla

**Files:**
- Create: `lib/mantenimiento/reprogramacionesDeLaPlanilla.ts`
- Test: `lib/mantenimiento/reprogramacionesDeLaPlanilla.test.ts`
- Modify: `lib/mantenimiento/sincronizar.ts:751` (donde ya corre `anotarLasDivergencias`)

**Interfaces:**
- Consumes: `OrdenDelSistema` de `lib/mantenimiento/contraste.ts`, `OrdenLeida` de `lib/mantenimiento/ordenes.ts`, `Reprogramacion` de la tarea 2.
- Produces:
  - `export const CERRADAS_PARA_REPROGRAMAR: readonly string[] = ["REALIZADO", "CANCELADA"]`
  - `export const TOPE_DE_FILAS_POR_CORRIDA: number`
  - `export function lasQueHayQueRegistrar(delSistema: readonly OrdenDelSistema[], deLaPlanilla: readonly OrdenLeida[], ultimaPorOt: ReadonlyMap<number, string>): { filas: { ot_number: number; fecha_anterior: string | null; fecha_nueva: string }[]; freno: string | null }` — `ultimaPorOt` es, por número de OT, el `fecha_nueva` de su última fila de historial.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
describe("lasQueHayQueRegistrar", () => {
  it("registra una OT abierta cuya fecha de inicio cambió");
  it("NO registra una OT cerrada (REALIZADO)");          // la decisión del spec
  it("NO registra una OT CANCELADA");
  it("NO registra si la fecha no cambió");
  it("NO registra una OT con sheets_pendiente");
  it("NO registra una OT con fecha_ejecucion_pendiente"); // la ventana del derrame
  it("NO registra si el sistema no tenía fecha y la planilla trae una"); // Review Focus 1
  it("SÍ registra si la planilla vacía una fecha que había");
  it("NO registra si la última fila del historial ya dice esa fecha nueva");
  it("SÍ registra si vuelve a una fecha que tuvo antes, cuando la última dice otra");
  it("corta y no devuelve ninguna fila si habría más que el tope, y dice por qué");
});

describe("CERRADAS_PARA_REPROGRAMAR", () => {
  it("dice lo mismo que CERRADAS_GUT", () => {
    expect(CERRADAS_PARA_REPROGRAMAR).toEqual(CERRADAS_GUT);
  });
});
```

Es la **tercera** copia de esos dos valores en el módulo, y es a propósito: ya hay dos —`CERRADAS` en `alertas.ts` y `CERRADAS_GUT` en `gut.ts`—, separadas porque responden preguntas distintas y el encabezado de `gut.ts` explica por qué no se espejan. Lo que no se puede es que se separen **sin que nadie se entere**, y para eso está ese test.

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/mantenimiento/reprogramacionesDeLaPlanilla.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar el módulo**

El encabezado explica las tres cosas que no se deducen del código: por qué quedan afuera las cerradas (los números del spec), por qué la comparación es contra **la última fila** y no un índice único, y qué deja abierto (dos corridas simultáneas, que en este sistema no las frena nada).

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run lib/mantenimiento/reprogramacionesDeLaPlanilla.test.ts`
Expected: PASS

- [ ] **Step 5: Engancharlo en la sincronización**

En `sincronizar.ts`, junto a `anotarLasDivergencias` y **antes del upsert**. Lee el último `fecha_nueva` por OT con `traerTodo()`, llama a la función, inserta las filas resolviendo `ot_number` a `ot_id`. **Nunca tira**: si la tabla no existe o el insert falla, devuelve el motivo y la sincronización sigue, igual que hace hoy `anotarLasDivergencias`. El freno se levanta con **su propia opción**, no con `sinFreno`, y **el cron no la pasa nunca**.

Lo que devuelve se suma al resumen de la corrida, como ya hacen las divergencias y los estados puestos.

- [ ] **Step 6: Verificar**

Run: `npx vitest run lib/mantenimiento && npx tsc --noEmit`
Expected: PASS y sin errores de tipos.

- [ ] **Step 7: Commit**

```bash
git add lib/mantenimiento/reprogramacionesDeLaPlanilla.ts lib/mantenimiento/reprogramacionesDeLaPlanilla.test.ts lib/mantenimiento/sincronizar.ts
git commit -m "feat(mantenimiento): lo que se corre en la planilla deja de perderse"
```

---

### Task 5: El filtro «Reprogramadas» del listado

**Files:**
- Modify: `lib/mantenimiento/filtrosOt.ts`
- Modify: `app/api/mantenimiento/ordenes/route.ts:110-143`
- Test: `lib/mantenimiento/filtrosOt.test.ts`

**Interfaces:**
- Consumes: `FiltrosOt`, `FILTROS_VACIOS`, `NOMBRES`, `escribirFiltrosEnLaUrl`, `leerFiltrosDeLaUrl` de `filtrosOt.ts`.
- Produces: `FiltrosOt` gana `reprogramacion: string[]`, con los valores `"hechas"` y `"necesitan"`; `export const VALORES_DE_REPROGRAMACION = ["hechas", "necesitan"] as const` y `export const ETIQUETA_DE_REPROGRAMACION: Record<(typeof VALORES_DE_REPROGRAMACION)[number], string>` (`Record` sobre el tuple y no sobre `string`, por lo que explica el encabezado de ese archivo: un ternario se tragó un valor nuevo y el desplegable mostró «Correctivo» tres veces).

- [ ] **Step 1: Escribir los tests que fallan**

```ts
describe("el filtro de reprogramación", () => {
  it("viaja a la URL como ?reprogramacion=hechas");
  it("acepta los dos valores a la vez y los escribe en orden");
  it("descarta un valor que no está en la lista");
  it("cuenta para hayAlgunFiltro");          // sí esconde filas, a diferencia de campoFecha
  it("vuelve a FILTROS_VACIOS al limpiar");
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/mantenimiento/filtrosOt.test.ts`
Expected: FAIL

- [ ] **Step 3: Agregar el filtro a `filtrosOt.ts`**

Una entrada más en `FiltrosOt`, en `FILTROS_VACIOS` y en `NOMBRES` (nombre de URL: `reprogramacion`). Nada más: el resto lo hace la maquinaria que ya está.

- [ ] **Step 4: Aplicarlo en la ruta**

En `app/api/mantenimiento/ordenes/route.ts`, junto a los otros `.in()`. Los dos valores **suman**, que es lo que se pidió cuando se preguntó cuál de las dos cosas significa «reprogramada»:

- `hechas` → `reprogramada_veces > 0`
- `necesitan` → `estado` fuera de `["REALIZADO","CANCELADA"]` **y** `fecha_ejecucion < hoyEnArgentina()`
- los dos → un `.or()` con las dos condiciones

El `hoy` sale de `hoyEnArgentina()` de `lib/core/fechas.ts`, no de `new Date()` en el servidor.

- [ ] **Step 5: Correr los tests y los tipos**

Run: `npx vitest run lib/mantenimiento/filtrosOt.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/mantenimiento/filtrosOt.ts lib/mantenimiento/filtrosOt.test.ts app/api/mantenimiento/ordenes/route.ts
git commit -m "feat(mantenimiento): filtrar el listado por las reprogramadas y las que lo necesitan"
```

---

### Task 6: La fila del listado muestra la cadena

**Files:**
- Create: `components/mantenimiento/CadenaDeFechas.tsx`
- Modify: `app/api/mantenimiento/ordenes/route.ts` (la respuesta del listado)
- Modify: `app/(app)/mantenimiento/ordenes/OrdenesClient.tsx:700-805`

**Interfaces:**
- Consumes: `cadenaDeFechas` de la tarea 2; `reprogramada_veces` de la tarea 1.
- Produces: `<CadenaDeFechas fechas={string[]} />` — todas tachadas menos la última, que va entera y con el año.

- [ ] **Step 1: Devolver los movimientos de la página**

En la ruta del listado, después de traer las órdenes de la página, una segunda consulta a `mant_reprogramaciones_ot` acotada a los ids de esa página —`.in("ot_id", ids)`, con el `limit` de la página muy por debajo del lote de 200—, ordenada por `creado_en` ascendente, y agrupada por OT en la respuesta.

- [ ] **Step 2: Escribir el componente**

`components/mantenimiento/CadenaDeFechas.tsx`. Las fechas intermedias tachadas en un solo `<span>` —no uno por fecha, para que el tachado sea continuo—, y la vigente aparte. Sin `white-space: nowrap` en el conjunto: con seis o más fechas tiene que poder partirse en dos renglones y **no se recorta ninguna**.

- [ ] **Step 3: Ponerlo en la fila**

Un `<p>` más dentro del bloque `.flex-1 min-w-0`, **debajo de `sector_raw · equipo_raw`**, sólo cuando `reprogramada_veces > 0`. Y el cartel `Reprog. ×N` entre los que ya están, con el mismo tamaño que «Sin justificar» y **sin cambiar de color por cantidad**.

La columna de fechas de la derecha **no se toca**: sigue mostrando la fecha vigente. El spec explica por qué (ahí la cadena se come la descripción).

- [ ] **Step 4: Verificar que entra en el teléfono**

Run: `node scripts/revisar-responsive.mjs`
Expected: ROMPE 0 · APRETADO 0 · MIRAR 0

- [ ] **Step 5: Verificar tipos y build**

Run: `npx tsc --noEmit && npm run build`
Expected: sin errores. (Parar `npm run dev` antes del build.)

- [ ] **Step 6: Commit**

```bash
git add components/mantenimiento/CadenaDeFechas.tsx app/api/mantenimiento/ordenes/route.ts "app/(app)/mantenimiento/ordenes/OrdenesClient.tsx"
git commit -m "feat(mantenimiento): la fila de una OT reprogramada muestra todas sus fechas"
```

---

### Task 7: El cálculo del análisis

**Files:**
- Create: `lib/mantenimiento/analisisDeOt.ts`
- Test: `lib/mantenimiento/analisisDeOt.test.ts`

**Interfaces:**
- Consumes: `semanaDe` de `lib/core/fechas.ts`; `CERRADAS_PARA_REPROGRAMAR` de la tarea 4.
- Produces:
  - `export interface OrdenParaAnalisis { id: string; ot_number: number; sector_raw: string | null; equipo_raw: string | null; tipo: string | null; descripcion: string | null; fecha_ejecucion: string | null; fecha_cierre: string | null; estado: string | null; app_created: boolean; reprogramada_veces: number; }`
  - `export interface AnalisisDeLaSemana { lunes: string; domingo: string; conInicio: number; cerradasDentro: number; cumplimiento: number | null; noCerraron: number; cerradasEnLaSemana: number; correctivasCerradas: number; porTipo: { tipo: string; cantidad: number; porcentaje: number }[]; diagnostico: string; lasDiez: { siguenAbiertas: number; cerraronDespues: number; cerraronAntes: number }; listas: { conInicio: OrdenParaAnalisis[]; sinCerrar: OrdenParaAnalisis[]; cerradasFueraDeFecha: OrdenParaAnalisis[]; cerradasEnLaSemana: OrdenParaAnalisis[] } }`
  - `export function analizarLaSemana(ordenes: readonly OrdenParaAnalisis[], unDiaDeLaSemana: string): AnalisisDeLaSemana`
  - `export function lasQueNecesitanReprogramarse(ordenes: readonly OrdenParaAnalisis[], hoy: string): OrdenParaAnalisis[]`

- [ ] **Step 1: Escribir los tests que fallan**

Con un fixture de ~12 órdenes **escrito en el test**, que reproduce la forma de la semana 45 y no sus números de producción:

```ts
describe("analizarLaSemana", () => {
  it("cuenta con inicio en la semana sin filtrar por tipo");      // la departida de la hoja
  it("cuenta las que además cerraron dentro de la misma semana");
  it("el cumplimiento es la división de las dos");
  it("el cumplimiento es null si no hay ninguna con inicio");      // Review Focus 3
  it("cuenta las cerradas en la semana aunque hayan empezado antes");
  it("las correctivas cerradas salen de las cerradas en la semana");
  it("el cuadro por tipo suma 100% y manda lo que no es programado ni correctivo a 'Otros'");
  it("abre las que no cerraron en siguen abiertas / cerraron después / cerraron antes");
  it("las tres partes suman exactamente las que no cerraron");
  it("una cerrada antes de su fecha de inicio cuenta en 'cerraron antes' y NO en 'fuera de fecha'"); // Review Focus 4
  it("las listas no filtran por tipo ni por estado");
  it("la semana es de lunes a domingo tome el día que tome");
});

describe("lasQueNecesitanReprogramarse", () => {
  it("son las abiertas con la fecha de inicio anterior a hoy");
  it("NO mira el valor ATRASADO del estado");
  it("deja afuera REALIZADO y CANCELADA");
  it("deja afuera las que no tienen fecha de inicio");
  it("ordena por días vencida, la más vieja primero");
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/mantenimiento/analisisDeOt.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar el módulo**

El encabezado explica las tres departidas respecto de la hoja —el nombre de «Con inicio en la semana», el desglose de las que no cerraron, y que las listas no filtran por tipo ni por estado— con el porqué de cada una, y deja escrito que los números de la semana 45 del spec son muestra de forma y se mueven solos.

El diagnóstico es la frase de una línea que la hoja arma, en castellano.

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run lib/mantenimiento/analisisDeOt.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/mantenimiento/analisisDeOt.ts lib/mantenimiento/analisisDeOt.test.ts
git commit -m "feat(mantenimiento): los seis numeros de la semana y sus cuatro listas"
```

---

### Task 8: La ruta del análisis

**Files:**
- Create: `app/api/mantenimiento/analisis/route.ts`

**Interfaces:**
- Consumes: `analizarLaSemana`, `lasQueNecesitanReprogramarse` de la tarea 7; `cadenaDeFechas`, `diasCorridos` de la tarea 2.
- Produces: `GET /api/mantenimiento/analisis?semana=YYYY-MM-DD` → `{ analisis, necesitan, reprogramaciones }`, donde `reprogramaciones` son las filas de historial con `creado_en` dentro de la semana, agrupadas por OT, con su cadena y sus días.

- [ ] **Step 1: Escribir la ruta**

Permiso: el mismo que el resto de Mantenimiento (`nivelMantenimientoDe`). Lectura de `ordenes_trabajo` con `traerTodo()` —son 2.531 y PostgREST corta en 1.000— y `select()` literal.

Dos alcances distintos y hay que respetarlos: `analisis` y `reprogramaciones` son **de la semana pedida**; `necesitan` es **contra `hoyEnArgentina()`**, no contra la semana. El spec dice por qué.

Las reprogramaciones entran por `creado_en`, y el comentario de la ruta deja dicho que para una fila `planilla` eso es cuándo lo vio la sincronización y no cuándo alguien editó la celda.

- [ ] **Step 2: Comprobarla contra la base**

Run: `npx tsx` con un script de un solo uso que pegue a la ruta local con la semana 45 y la actual, e imprima los seis números y los tres totales de `necesitan`.
Expected: los números salen y el desglose de las que no cerraron suma el total.

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add app/api/mantenimiento/analisis/route.ts
git commit -m "feat(mantenimiento): la ruta que contesta el analisis de una semana"
```

---

### Task 9: La pantalla de Análisis

**Files:**
- Create: `app/(app)/mantenimiento/analisis/page.tsx`
- Create: `app/(app)/mantenimiento/analisis/AnalisisClient.tsx`
- Modify: el menú del módulo, donde estén los enlaces de Mantenimiento

**Interfaces:**
- Consumes: la ruta de la tarea 8; `<CadenaDeFechas>` de la tarea 6.
- Produces: la pantalla en `/mantenimiento/analisis`.

- [ ] **Step 1: La página**

`page.tsx` como las otras del módulo: `createClient()`, `getUser()`, `redirect("/login")` si no hay, `nivelMantenimientoDe` para el permiso, y el cliente adentro.

- [ ] **Step 2: El cliente**

De arriba abajo: la barra con `← Semana N →` y el rango leído; las seis métricas; el cuadro por tipo con su diagnóstico y el panel de las tres partes; las seis pestañas; y la lista de la pestaña elegida.

Las seis métricas son una grilla: **`grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`**, nunca `grid-cols-6` pelado — en 343 px seis columnas dan 57 px cada una.

La pestaña «Necesitan reprogramarse» lleva **«hoy» en el rótulo**, porque es la única que no se mueve con las flechas y un número quieto al lado de cuatro que se mueven se lee como un error.

Esa pestaña lleva arriba los tres chips —`N en total`, `N se pueden postergar desde el sistema`, `N hay que cambiarlas en la planilla`— y, por fila, el botón **Postergar** si la OT es `app_created`, y si no el texto **«Entró por el formulario — se cambia en la planilla»**.

En la pestaña de Reprogramaciones, una fila de origen `planilla` muestra **«Cambiada en la planilla»** donde las otras muestran la razón, y **no renderiza la justificación ni el autor** — ni comillas vacías ni «undefined». *(Review Focus 5.)*

Un botón rojo es `.btn-danger`; `text-red-700` al lado de un `.btn-*` no se aplica. Un ancho va en un `div` que envuelva al campo.

- [ ] **Step 3: El enlace en el menú del módulo**

- [ ] **Step 4: Verificar**

Run: `node scripts/revisar-responsive.mjs && npx tsc --noEmit && npm run build`
Expected: ROMPE 0 · APRETADO 0 · MIRAR 0, sin errores, build verde.

- [ ] **Step 5: Mirarla en el navegador**

Abrirla con sesión, moverse una semana para atrás y para adelante, entrar a las seis pestañas, y comprobar que el número de «Necesitan reprogramarse» **no cambia** al mover la semana y que los otros cinco sí.

Y lo del Review Focus 5, que ningún test de este repo puede atrapar porque las pantallas no tienen tests: **mirar una fila de origen `planilla` en la pestaña de Reprogramaciones** —insertando una a mano si todavía no hay ninguna— y confirmar que dice «Cambiada en la planilla» y que no aparecen ni comillas vacías ni «undefined» donde irían la justificación y el autor.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/mantenimiento/analisis/page.tsx" "app/(app)/mantenimiento/analisis/AnalisisClient.tsx"
git commit -m "feat(mantenimiento): la pantalla de analisis de OT"
```

---

### Task 10: Dejarlo escrito

**Files:**
- Modify: `docs/MANTENIMIENTO-INTEGRACION.md`
- Modify: `CLAUDE.md`
- Modify: `docs/API.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada que importe código.

- [ ] **Step 1: La sección en `docs/MANTENIMIENTO-INTEGRACION.md`**

`## La reprogramación de una OT y el Análisis`, con lo que no se deduce del código: que el historial tiene dos orígenes y que el de la planilla **deja afuera las cerradas** (con los números); que «abierta» es el estado y no la fecha de cierre, y que el que no se usa es el valor `ATRASADO`; que el contador va por trigger; que las listas del análisis no filtran por tipo aunque la hoja sí; y qué queda abierto (dos corridas simultáneas; la OT postergada en la planilla que cierra antes de la corrida siguiente).

- [ ] **Step 2: El renglón en `CLAUDE.md`**

En la tabla de Mantenimiento, el enlace al spec y al plan con las dos o tres cosas que no se deducen del código. No inflarlo: un renglón que crece sin medida deja de leerse.

- [ ] **Step 3: `docs/API.md`**

La ruta nueva. El inventario de `docs/API-MAPA.generado.md` **no se edita a mano**: `npm run mapa-de-apis`.

- [ ] **Step 4: Verificar todo junto**

Run: `npm test && npx tsc --noEmit && npm run build && node scripts/revisar-exportaciones.mjs && node scripts/revisar-responsive.mjs && node scripts/revisar-arbol-commiteado.mjs`
Expected: todo verde. `revisar-exportaciones` tiene que seguir en **ROMPE 0 · MIRAR 2**: nada de esto escribe en una planilla.

- [ ] **Step 5: Commit**

```bash
git add docs/MANTENIMIENTO-INTEGRACION.md CLAUDE.md docs/API.md docs/API-MAPA.generado.md
git commit -m "docs(mantenimiento): que guarda el historial de reprogramaciones y que no"
```
