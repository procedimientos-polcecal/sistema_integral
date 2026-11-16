# Las vacaciones cargadas desde RRHH figuran en Disponibilidad — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que todo período de vacaciones nazca de una ausencia, para que lo que
se carga en RRHH → Vacaciones aparezca en `/disponibilidad` sin cargarlo dos
veces.

**Architecture:** El cambio va en la **ruta** `/api/rrhh/vacaciones`, no en las
pantallas: así lo heredan las dos que postean ahí (Balance por empleado y la
ficha del empleado) y cualquier tercera que aparezca. El `POST` pasa por
`altaDeAusencia()`, que ya inserta la ausencia, llama a
`sincronizarPeriodoVacaciones()` —que escribe la fila de `vacaciones` con su
`ausencia_id`— y recalcula. El `PUT` y el `DELETE` operan sobre la ausencia y
dejan que la sincronización y el `on delete cascade` hagan el resto. Nada de
`lib/rrhh/ausentismo/` ni de la pantalla de Disponibilidad se toca.

**Tech Stack:** Next.js 16 App Router, Supabase (PostgREST), zod, vitest.

**Spec:** [docs/superpowers/specs/2026-11-16-vacaciones-en-disponibilidad-design.md](../specs/2026-11-16-vacaciones-en-disponibilidad-design.md)

## Global Constraints

- Todo en **castellano**: nombres, comentarios, mensajes de pantalla y de commit.
- **Nunca `git add -A`.** Cada commit nombra sus archivos; puede haber otra
  sesión en el mismo árbol.
- **No hay DDL.** Ninguna tarea escribe una migración. El relleno es DML.
- **No se toca** `lib/rrhh/ausentismo/*`, `app/(app)/disponibilidad/*`,
  `lib/rrhh/engine/recalcular.ts`, ni `app/(app)/rrhh/ausencias/AusenciasClient.tsx`.
- **No se toca** `app/api/rrhh/ausencias/[id]/route.ts` ni
  `app/api/mantenimiento/ausencias/route.ts`: sus ayudantes de auditoría quedan
  donde están (ver Task 2).
- Un desplegable se escribe `<Select>`, no `<select>`. Una grilla de tres
  columnas lleva breakpoint (`grid-cols-1 sm:grid-cols-3`).
- `className="input w-20"` no mide 20: el ancho va en un `div` que envuelva al
  campo. (Los campos que toca Task 5 usan `border …` suelto, no `.input`, así
  que ahí no aplica — comprobarlo antes de agregar clases.)
- Verbo de auditoría: sólo los nueve de `ACCIONES`. Acá se usan `corregir` y
  `borrar`, y `corregir` **necesita** `valor_anterior` y `valor_nuevo`.

## Review Focus

Cinco entradas que el diseño implica y que ninguna tarea testearía sola. Cada
una tiene su test asignado abajo.

1. **Un `PUT` que sólo cambia `anioCorrespondiente`.** Ese campo vive en
   `vacaciones`, no en `ausencias`, así que no produce ningún cambio de columna
   en la ausencia. Si la ruta aborta con «no hay nada para cambiar», el año no
   se puede corregir nunca. → Task 4, Step 1.
2. **Un `PUT` con el cuerpo vacío `{}`.** Todos los campos son opcionales. Sin
   un freno de no-op se escribe una fila de auditoría permanente —la tabla no
   tiene delete ni update— por un cambio que no ocurrió. → Task 4, Step 1.
3. **Un `POST` sin `anioCorrespondiente`.** Hoy la ruta lo rellena con
   `new Date().getFullYear()`; `altaDeAusencia` lo **rechaza** con 400. La ficha
   del empleado manda `Number("")` = `NaN`, que no es un entero. El 400 es el
   comportamiento correcto y hay que fijarlo. → Task 1, Step 1.
4. **`fechaDesde` posterior a `fechaHasta`.** Nadie lo valida hoy, y
   `diasEntre()` devuelve un negativo que iba a `dias_tomados`. El
   `z.number().min(0)` que lo tapaba desaparece junto con el campo. → Task 1,
   Step 1.
5. **`diasTomados` que llega igual en el cuerpo**, desde una pestaña vieja con
   el formulario anterior cargado. Tiene que ignorarse, no escribirse: después
   de esto `dias_tomados` sale siempre del calendario. → Task 4, Step 1.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `lib/rrhh/periodoDeVacaciones.ts` *(nuevo)* | Las decisiones puras: cómo se traduce el cuerpo de un período a los datos de una ausencia, y qué campos toca un `PUT` parcial. |
| `lib/rrhh/periodoDeVacaciones.test.ts` *(nuevo)* | Sus tests. |
| `lib/rrhh/auditoriaDelPeriodo.ts` *(nuevo)* | Cómo se lee un período en una línea (pura) y el registro que va antes del cambio. |
| `lib/rrhh/auditoriaDelPeriodo.test.ts` *(nuevo)* | Test de la función pura. |
| `app/api/rrhh/vacaciones/route.ts` | `POST` → `altaDeAusencia`. |
| `app/api/rrhh/vacaciones/[id]/route.ts` | `PUT`/`DELETE` → la ausencia, con auditoría. |
| `app/(app)/rrhh/vacaciones/VacacionesClient.tsx` | «Días» calculado. |
| `app/(app)/rrhh/empleados/[id]/EmpleadoDetalle.tsx` | «Días» calculado. |
| `scripts/vacaciones-huerfanas-a-ausencias.mts` *(nuevo)* | El relleno de los 20, en seco por defecto. |
| `docs/RRHH-ACTUALIZACION.md`, `CLAUDE.md` | Lo que no se deduce del código. |

---

### Task 1: Las decisiones puras del período

**Files:**
- Create: `lib/rrhh/periodoDeVacaciones.ts`
- Test: `lib/rrhh/periodoDeVacaciones.test.ts`

**Interfaces:**
- Consumes: `DatosDeAusencia` de `lib/rrhh/altaDeAusencia.ts`; `diasEntre` de `lib/rrhh/vacacionesDeAusencia.ts` (ya exportada — **se reusa, no se copia**).
- Produces:
  - ```ts
    export interface CuerpoDePeriodo {
      employeeId?: string;
      anioCorrespondiente?: number;
      fechaDesde?: string;
      fechaHasta?: string;
      observaciones?: string | null;
      /** Llega de una pestaña vieja con el formulario anterior. Se ignora a propósito. */
      diasTomados?: number;
    }
    ```
  - `export function datosDeAusenciaDeVacaciones(cuerpo: CuerpoDePeriodo, cargadoPorId: string): DatosDeAusencia`
  - `export function cambiosParaLaAusencia(cuerpo: CuerpoDePeriodo): Record<string, unknown>`
  - `export function hayAlgoQueCambiar(cuerpo: CuerpoDePeriodo): boolean`
  - `export function rangoAlReves(desde: string, hasta: string): boolean`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
import { describe, it, expect } from "vitest";
import { datosDeAusenciaDeVacaciones, cambiosParaLaAusencia, hayAlgoQueCambiar, rangoAlReves } from "./periodoDeVacaciones";

describe("datosDeAusenciaDeVacaciones", () => {
  it("fija el tipo y la justificación, que son lo que hace existir al período", () => {
    const d = datosDeAusenciaDeVacaciones(
      { employeeId: "e1", anioCorrespondiente: 2025, fechaDesde: "2026-07-27", fechaHasta: "2026-08-03" },
      "u1",
    );
    expect(d.tipo).toBe("VACACIONES");
    expect(d.justificada).toBe(true);
    expect(d.anioCorrespondiente).toBe(2025);
    expect(d.cargadoPorId).toBe("u1");
    expect(d.fechaDesde).toBe("2026-07-27");
    expect(d.fechaHasta).toBe("2026-08-03");
  });

  // Review Focus 3: el año no se inventa. `altaDeAusencia` devuelve 400 si no es
  // entero, y eso es lo correcto: antes la ruta ponía el año actual por defecto
  // y descontaba del balance equivocado sin decir nada.
  it("no inventa el año cuando no vino", () => {
    const d = datosDeAusenciaDeVacaciones({ employeeId: "e1", fechaDesde: "2026-07-27", fechaHasta: "2026-08-03" }, "u1");
    expect(d.anioCorrespondiente).toBeUndefined();
  });

  it("no inventa el año cuando llegó NaN (la ficha manda Number(\"\"))", () => {
    const d = datosDeAusenciaDeVacaciones({ employeeId: "e1", anioCorrespondiente: NaN, fechaDesde: "a", fechaHasta: "b" }, "u1");
    expect(d.anioCorrespondiente).toBeUndefined();
  });
});

describe("cambiosParaLaAusencia", () => {
  it("traduce sólo los campos que vinieron", () => {
    expect(cambiosParaLaAusencia({ fechaHasta: "2026-08-10" })).toEqual({ fecha_hasta: "2026-08-10" });
  });

  // Review Focus 1: el año NO es un campo de la ausencia. Que no aparezca acá es
  // lo que obliga a la ruta a tratarlo aparte en vez de abortar por "sin cambios".
  it("deja el año afuera: vive en el período, no en la ausencia", () => {
    expect(cambiosParaLaAusencia({ anioCorrespondiente: 2026 })).toEqual({});
  });

  // Review Focus 5: una pestaña vieja todavía manda diasTomados.
  it("ignora diasTomados aunque venga en el cuerpo", () => {
    expect(cambiosParaLaAusencia({ fechaDesde: "2026-07-27", diasTomados: 3 })).toEqual({
      fecha_desde: "2026-07-27",
    });
  });

  it("un cuerpo vacío no produce cambios", () => {
    expect(cambiosParaLaAusencia({})).toEqual({});
  });

  it("observaciones vacío se guarda como null y no como cadena vacía", () => {
    expect(cambiosParaLaAusencia({ observaciones: "" })).toEqual({ observaciones: null });
  });
});

// Review Focus 1 y 2 juntos: lo que la ruta del PUT tiene que poder distinguir.
describe("hayAlgoQueCambiar", () => {
  it("un cuerpo vacío no tiene nada que cambiar", () => {
    expect(hayAlgoQueCambiar({})).toBe(false);
  });
  it("sólo el año sí tiene algo que cambiar, aunque no toque la ausencia", () => {
    expect(hayAlgoQueCambiar({ anioCorrespondiente: 2026 })).toBe(true);
  });
  it("sólo diasTomados no es nada que cambiar: se ignora", () => {
    expect(hayAlgoQueCambiar({ diasTomados: 9 })).toBe(false);
  });
});

// Review Focus 4: nadie validaba esto, y `diasEntre` devolvía un negativo que
// terminaba en `dias_tomados`.
describe("rangoAlReves", () => {
  it("dice que sí cuando hasta es anterior a desde", () => {
    expect(rangoAlReves("2026-08-03", "2026-07-27")).toBe(true);
  });
  it("un solo día no está al revés", () => {
    expect(rangoAlReves("2026-07-27", "2026-07-27")).toBe(false);
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run lib/rrhh/periodoDeVacaciones.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Escribir `lib/rrhh/periodoDeVacaciones.ts`**

Las firmas están en **Produces**. El encabezado del archivo explica por qué
estas decisiones viven acá y no en la ruta: las rutas de este repo no tienen
tests, y éstas son las que, si salen mal, dejan un período descontando del año
equivocado o una edición que no se puede guardar.

`hayAlgoQueCambiar` es verdadero si `cambiosParaLaAusencia` devuelve algo **o**
si vino `anioCorrespondiente` — ese «o» es todo el punto: el año no es un campo
de la ausencia y sin él la ruta abortaría una corrección legítima.

`cambiosParaLaAusencia` mapea `employeeId→empleado_id`, `fechaDesde→fecha_desde`,
`fechaHasta→fecha_hasta`, `observaciones→(valor || null)`, y **nada más**. Las
fechas se comparan como texto: son ISO y ordenan igual.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npx vitest run lib/rrhh/periodoDeVacaciones.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/rrhh/periodoDeVacaciones.ts lib/rrhh/periodoDeVacaciones.test.ts
git commit -m "feat(rrhh): las decisiones puras para que un periodo de vacaciones nazca de una ausencia"
```

---

### Task 2: El registro de auditoría de un período

**Files:**
- Create: `lib/rrhh/auditoriaDelPeriodo.ts`
- Test: `lib/rrhh/auditoriaDelPeriodo.test.ts`

**Por qué un archivo propio y no mudar el de `rrhh/ausencias/[id]`.** El spec
dejaba la elección abierta. Se decide **no mudar nada**: `comoSeLee` y
`problemaDeAuditoria` ya están duplicados entre RRHH y Mantenimiento *a
propósito*, con el porqué escrito en su docstring, y mover el de RRHH obligaría
a tocar una ruta que esta tarea no necesita cambiar —en un árbol donde suele
haber otra sesión trabajando—. Además lo que hay que registrar acá **no es lo
mismo**: el `anio_correspondiente` vive en `vacaciones` y no en `ausencias`, y
es justamente el campo cuya pérdida mueve el balance de un año a otro. Por eso
la entidad del registro es `vacaciones` y no `ausencias`.

**Interfaces:**
- Consumes: `auditar`, `nombreParaAuditoria` de `lib/core/auditoria.ts`.
- Produces:
  - `export interface PeriodoParaAuditoria { id: string; empleado_id: string; ausencia_id: string | null; anio_correspondiente: unknown; fecha_desde: unknown; fecha_hasta: unknown; dias_tomados: unknown; observaciones: unknown }`
  - `export function comoSeLeeElPeriodo(p: Omit<PeriodoParaAuditoria, "id" | "empleado_id" | "ausencia_id">): string`
  - `export async function problemaDeAuditoriaDelPeriodo(supabase: SupabaseClient, accion: "corregir" | "borrar", anterior: PeriodoParaAuditoria, valorNuevo: string | null): Promise<NextResponse | null>`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect } from "vitest";
import { comoSeLeeElPeriodo } from "./auditoriaDelPeriodo";

describe("comoSeLeeElPeriodo", () => {
  it("dice el año, el rango y los días, que es lo que se pierde al corregir", () => {
    expect(comoSeLeeElPeriodo({
      anio_correspondiente: 2025, fecha_desde: "2026-07-27", fecha_hasta: "2026-08-03",
      dias_tomados: 8, observaciones: null,
    })).toBe("Vacaciones 2025 del 2026-07-27 al 2026-08-03 (8 días)");
  });

  it("corta el timestamp que a veces devuelve la base", () => {
    expect(comoSeLeeElPeriodo({
      anio_correspondiente: 2025, fecha_desde: "2026-07-27T00:00:00+00:00", fecha_hasta: "2026-08-03T00:00:00+00:00",
      dias_tomados: 8, observaciones: null,
    })).toBe("Vacaciones 2025 del 2026-07-27 al 2026-08-03 (8 días)");
  });

  it("agrega las observaciones cuando las hay", () => {
    expect(comoSeLeeElPeriodo({
      anio_correspondiente: 2025, fecha_desde: "2026-07-27", fecha_hasta: "2026-08-03",
      dias_tomados: 8, observaciones: "  adelanta una semana  ",
    })).toBe("Vacaciones 2025 del 2026-07-27 al 2026-08-03 (8 días) — adelanta una semana");
  });

  it("unas observaciones en blanco no agregan el guión", () => {
    expect(comoSeLeeElPeriodo({
      anio_correspondiente: 2025, fecha_desde: "2026-07-27", fecha_hasta: "2026-08-03",
      dias_tomados: 8, observaciones: "   ",
    })).toBe("Vacaciones 2025 del 2026-07-27 al 2026-08-03 (8 días)");
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run lib/rrhh/auditoriaDelPeriodo.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Escribir `lib/rrhh/auditoriaDelPeriodo.ts`**

`problemaDeAuditoriaDelPeriodo` sigue **el mismo contrato** que
`app/api/rrhh/ausencias/[id]/route.ts`, que es el modelo a copiar (leerlo
antes): saca el usuario con `supabase.auth.getUser()`, le busca el nombre con
`nombreParaAuditoria`, llama a `auditar()` con

- `modulo: "rrhh"`, `entidad: "vacaciones"`, `entidadId: anterior.id`,
- `valorAnterior: comoSeLeeElPeriodo(anterior)`, `valorNuevo`,
- `contexto: { ruta: "rrhh/vacaciones", empleado_id, ausencia_id, anterior: { … } }`,

y **devuelve un 500 si el registro no entra**, con el mismo texto que la otra
punta («No se pudo registrar el borrado/la corrección en la auditoría, así que
no se borró/no se cambió nada: …»). El registro va **antes** del cambio.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run lib/rrhh/auditoriaDelPeriodo.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/rrhh/auditoriaDelPeriodo.ts lib/rrhh/auditoriaDelPeriodo.test.ts
git commit -m "feat(rrhh): el registro de auditoria de un periodo de vacaciones"
```

---

### Task 3: El `POST` de `/api/rrhh/vacaciones` crea la ausencia

**Files:**
- Modify: `app/api/rrhh/vacaciones/route.ts` (el `POST`, líneas 26-52)

**Interfaces:**
- Consumes: `datosDeAusenciaDeVacaciones`, `rangoAlReves` (Task 1); `altaDeAusencia` de `lib/rrhh/altaDeAusencia.ts`.
- Produces: la ruta sigue devolviendo **el período** con 201, no la ausencia.

- [ ] **Step 1: Reescribir el `POST`**

El cuerpo nuevo, en orden:

1. `puede_editar_check` como hoy.
2. Leer el cuerpo con `cuerpoJson`.
3. Si falta `employeeId`, `fechaDesde` o `fechaHasta` → 400 `"Datos inválidos"`
   (el mensaje que la pantalla ya conoce). **`diasTomados` deja de pedirse.**
4. Si `rangoAlReves(fechaDesde, fechaHasta)` → 400
   `"La fecha hasta no puede ser anterior a la fecha desde"`.
5. `const { data: { user } } = await supabase.auth.getUser()`.
6. `altaDeAusencia(supabase, datosDeAusenciaDeVacaciones(body, user!.id))`.
   Si devuelve `error`, contestarlo **tal cual** con su `status`: son los
   mensajes en castellano que ya existen, incluido el de «Para Vacaciones hay
   que indicar a qué año corresponden los días».
7. Leer el período recién creado —`from("vacaciones").select("*").eq("ausencia_id", ausencia.id).single()`—
   y devolverlo con 201.

**Se borra** la llamada suelta a `recalcularEmpleadoPeriodo`: `altaDeAusencia`
ya la hace por dentro, **después** de que `sincronizarPeriodoVacaciones` creó el
período, que es el orden que da `ausente: false`. Dejarla la corre dos veces.

Un comentario arriba del handler dice por qué esta ruta ya no inserta en
`vacaciones`: una fila de `vacaciones` sin ausencia es invisible para
Disponibilidad, para el taller y para los tres reportes, y así eran 20 de 41.

- [ ] **Step 2: Comprobar que compila**

Run: `npx tsc --noEmit`
Expected: sin errores en `app/api/rrhh/vacaciones/route.ts`.

- [ ] **Step 3: Commit**

```bash
git add app/api/rrhh/vacaciones/route.ts
git commit -m "feat(rrhh): cargar vacaciones crea la ausencia, para que figuren en Disponibilidad"
```

---

### Task 4: El `PUT` y el `DELETE` operan sobre la ausencia

**Files:**
- Modify: `app/api/rrhh/vacaciones/[id]/route.ts` (entero)

**Interfaces:**
- Consumes: `cambiosParaLaAusencia`, `hayAlgoQueCambiar`, `rangoAlReves` (Task 1); `problemaDeAuditoriaDelPeriodo`, `comoSeLeeElPeriodo` (Task 2); `sincronizarPeriodoVacaciones` de `lib/rrhh/vacacionesDeAusencia.ts`; `recalcularEmpleadoPeriodo`.

- [ ] **Step 1: Reescribir el `PUT`**

Al esquema `Cuerpo` de zod se le **saca** `diasTomados`. En orden:

1. `puede_editar_check`; validar con `validar`/`errorDeValidacion`.
2. Traer el período: `select("id, empleado_id, ausencia_id, anio_correspondiente, fecha_desde, fecha_hasta, dias_tomados, observaciones")`. Si no está → 404 `"No encontrado"`.
3. Si `!hayAlgoQueCambiar(body)` → 400 con el texto
   `"No hay nada para cambiar: mandá al menos uno de empleado, fechaDesde, fechaHasta, anioCorrespondiente u observaciones"`.
   *(Review Focus 2: sin este freno se escribe una fila de auditoría permanente por un no-op.)*
4. Calcular las fechas finales (las del cuerpo o las del período) y, si
   `rangoAlReves` → 400 con el mismo texto que el `POST`.
5. **Si el período no tiene `ausencia_id`:** comportarse como hoy (update sobre
   `vacaciones`, recálculo de los dos rangos) y **sin registro de auditoría**:
   no es una ausencia y nunca lo fue.
6. **Si lo tiene:**
   a. `problemaDeAuditoriaDelPeriodo(supabase, "corregir", periodo, comoSeLeeElPeriodo({ …periodo, …loQueQueda }))`; si devuelve algo, contestarlo y **no escribir nada**.
   b. `const cambios = cambiosParaLaAusencia(body)`. Si tiene claves, `update` sobre `ausencias` con `.select().single()`; si no —cambió sólo el año—, traer la ausencia tal cual está.
   c. `sincronizarPeriodoVacaciones(supabase, ausencia, body.anioCorrespondiente)`.
      *(Review Focus 1: éste es el único paso que guarda el año, y corre también cuando `cambios` está vacío.)*
   d. `recalcularEmpleadoPeriodo` sobre el rango **anterior** y, si el empleado o las fechas cambiaron, también sobre el nuevo — igual que hoy.
   e. Devolver el período releído.

- [ ] **Step 2: Reescribir el `DELETE`**

1. `puede_editar_check`; traer el período como en el `PUT`; 404 si no está.
2. Si **no** tiene `ausencia_id`: borrar el período y recalcular, como hoy, sin registro.
3. Si lo tiene: `problemaDeAuditoriaDelPeriodo(supabase, "borrar", periodo, null)`;
   si devuelve algo, contestarlo. Después borrar la **ausencia**
   (`from("ausencias").delete().eq("id", periodo.ausencia_id)`) — el
   `on delete cascade` se lleva la fila de `vacaciones` — y recalcular el rango.
4. 204 como hoy.

- [ ] **Step 3: Comprobar que compila y que la suite sigue verde**

Run: `npx tsc --noEmit && npm test`
Expected: sin errores; todos los tests pasan.

- [ ] **Step 4: Commit**

```bash
git add app/api/rrhh/vacaciones/[id]/route.ts
git commit -m "feat(rrhh): corregir o borrar unas vacaciones toca la ausencia y queda auditado"
```

---

### Task 5: El campo «Días» se calcula

**Files:**
- Modify: `app/(app)/rrhh/vacaciones/VacacionesClient.tsx` (el form de `Balance`, líneas ~54-120)
- Modify: `app/(app)/rrhh/empleados/[id]/EmpleadoDetalle.tsx` (`guardarVacacion` y su formulario, líneas ~245-285)

**Interfaces:**
- Consumes: `diasEntre` de `lib/rrhh/vacacionesDeAusencia.ts`.

- [ ] **Step 1: Sacar el `<input>` de «Días» de los dos formularios**

En su lugar, un texto que muestre `diasEntre(fechaDesde, fechaHasta)` cuando las
dos fechas están completas —y nada cuando no—, con el rótulo «Días». Los dos
formularios **dejan de mandar `diasTomados`** en el cuerpo.

Las tablas que **muestran** `p.dias_tomados` no se tocan: ése es el valor
guardado y es el que se descuenta del balance.

- [ ] **Step 2: Comprobar que compila y que no quedó nada apretado**

Run: `npx tsc --noEmit && node scripts/revisar-responsive.mjs`
Expected: sin errores; ROMPE 0 · APRETADO 0 · MIRAR 0.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/rrhh/vacaciones/VacacionesClient.tsx" "app/(app)/rrhh/empleados/[id]/EmpleadoDetalle.tsx"
git commit -m "fix(rrhh): los dias de un periodo de vacaciones se calculan y no se tipean"
```

---

### Task 6: El relleno de los 20 huérfanos

**Files:**
- Create: `scripts/vacaciones-huerfanas-a-ausencias.mts`

**Interfaces:**
- Consumes: `createAdminClient` de `lib/supabase/admin.ts`; el patrón de carga de
  `.env.local` de `scripts/probar-rutas-de-disponibilidad.mts` (líneas 28-38) —
  **copiarlo de ahí**, no inventar otro.

- [ ] **Step 1: Escribir el script**

Encabezado con el porqué, como el resto de los scripts del repo. Toma
`--usuario=<uuid>` (obligatorio, el `cargado_por_id`; va **Bernardo**, que el
usuario eligió) y `--aplicar` (sin él, **sólo imprime**). Por cada período con
`ausencia_id` nulo:

1. Volver a comprobar que no pisa una ausencia del mismo empleado
   (`fecha_desde <= v.fecha_hasta and fecha_hasta >= v.fecha_desde`). Si pisa,
   **saltear e informar**: medido eran 0 de 20, pero esto corre después.
2. Insertar la ausencia: mismo empleado y fechas, `tipo: "VACACIONES"`,
   `justificada: true`, `cargado_por_id` el del parámetro, y `observaciones` =
   las del período (si las hay) más, en una línea al final:
   `Vacaciones cargadas desde Balance por empleado. La ausencia se creó el 16/11/2026 al unificar las dos puertas de carga.`
3. `update` sobre `vacaciones` poniéndole el `ausencia_id`. **No toca
   `dias_tomados`.**

**No recalcula `calculos_diarios`:** sería un no-op, porque `recalcular.ts` lee
`vacaciones` directo y la vacación ya le ganaba a la ausencia. Decirlo en el
encabezado, para que nadie lo agregue creyendo que falta.

Al final imprime: cuántos convirtió, cuántos salteó y por qué, y **la lista de
los períodos cuyo `dias_tomados` no coincide con el calendario** —los 2
huérfanos más el que ya tenía ausencia—, con la aclaración de que no se tocan y
de que la primera edición desde la pantalla los va a pasar al calendario.

- [ ] **Step 2: Correr en seco contra producción**

Run: `npx tsx scripts/vacaciones-huerfanas-a-ausencias.mts --usuario=<uuid de Bernardo>`
Expected: dice que convertiría **20**, saltearía 0, y lista los 3 `dias_tomados`
divergentes. **No escribe nada.**

- [ ] **Step 3: Commit (sin aplicar todavía)**

```bash
git add scripts/vacaciones-huerfanas-a-ausencias.mts
git commit -m "feat(rrhh): el script que convierte en ausencias los 20 periodos de vacaciones huerfanos"
```

---

### Task 7: Lo que no se deduce del código

**Files:**
- Modify: `docs/RRHH-ACTUALIZACION.md` (sección nueva)
- Modify: `CLAUDE.md` (la cuenta de llamadores de `auditar()` y el renglón de Disponibilidad)

- [ ] **Step 1: Escribir la sección en `docs/RRHH-ACTUALIZACION.md`**

Cuatro cosas, con los números medidos:

- **Toda vacación nace de una ausencia**, y el arreglo vive en la ruta y no en
  la pantalla: por eso lo heredan Balance, la ficha del empleado y cualquier
  pantalla futura.
- **La liquidación nunca estuvo ciega a los períodos huérfanos**:
  `recalcular.ts` lee `vacaciones` directo y la vacación gana. Los ciegos eran
  Disponibilidad, el taller y los tres reportes. Está escrito porque la primera
  versión del spec decía lo contrario y alguien podría usarlo para tocar el motor.
- **Los reportes subieron 215 días** (julio 172→232, agosto 161→186, septiembre
  119→136, octubre 116→136, noviembre **35→128**) el día del relleno. No es un
  error: son 20 períodos que faltaban.
- **Tres períodos tienen `dias_tomados` a mano distinto del calendario** y **no
  se normalizaron a propósito**: 24/09→01/10 dice 7 y son 8, 11/11→25/11 dice 14
  y son 15, 13/10→19/10 dice 8 y son 7. La primera edición de cada uno los pasa
  al calendario y mueve ese balance un día.
- **Las ausencias de vacaciones no se ven en RRHH → Ausencias**, porque la
  pestaña «Licencias» filtra con `excluirTipo=VACACIONES`. Es a propósito.

- [ ] **Step 2: Actualizar la cuenta de `CLAUDE.md`**

Correr `grep -rln "auditar(" app lib` y **contar de nuevo**, descartando las que
sólo lo nombran en un comentario. Ese renglón ya quedó desactualizado una vez
—decía «nueve» cuando eran catorce—, así que se escribe el número que da el
grep, no el que se supone. Agregar a la lista: **corregir o borrar un período de
vacaciones** (`rrhh/vacaciones/[id]`), que borra la ausencia y se lleva el
período en cascada, y cuyo `corregir` existe sobre todo por el
`anio_correspondiente` — el campo que decide de qué año se descuentan los días.

Y en el renglón de Disponibilidad, la quinta cosa que no se deduce del código:
**un período de vacaciones figura porque es una ausencia**, no porque
Disponibilidad lea la tabla `vacaciones` — que no la lee.

- [ ] **Step 3: Verificación completa**

```bash
npm test
npx tsc --noEmit
npm run build
node scripts/revisar-arbol-commiteado.mjs
node scripts/revisar-responsive.mjs
node scripts/revisar-exportaciones.mjs
```

Expected: todo verde. (`revisar-exportaciones` no debería moverse: nada de esto
escribe una planilla.)

- [ ] **Step 4: Commit**

```bash
git add docs/RRHH-ACTUALIZACION.md CLAUDE.md
git commit -m "docs(rrhh): por que una vacacion es una ausencia, y que se movio al unificarlo"
```

---

## Después del plan: los dos pasos que no son código

Van en este orden y **no** antes de desplegar:

1. **Desplegar** (push a `main`). Hasta acá nada cambió en producción: el script
   está commiteado pero no aplicado.
2. **Avisar a los encargados** —lo hace el usuario— de que va a entrar una carga
   de 20 ausencias de vacaciones viejas, y recién después correr
   `npx tsx scripts/vacaciones-huerfanas-a-ausencias.mts --usuario=<uuid> --aplicar`.
   El correo de novedades de las 18:50 UTC de ese día va a listar las veinte a
   los doce encargados. Es lo acordado.
3. **Comprobar el resultado**:
   `npx tsx scripts/probar-rutas-de-disponibilidad.mts --mes=2026-11`
   — los 4 períodos vigentes o futuros tienen que aparecer en el JSON de
   `/api/disponibilidad`, y ningún motivo tiene que salir. Sale 1 si algo se
   filtró.
