# Programación semanal del taller — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el encargado de Mantenimiento vea la semana del taller con los tres turnos, los huecos que dejan las ausencias cargadas en el SdG y quién puede taparlos, y que pueda anotar la falta de uno de los suyos sin que eso le abra RRHH.

**Architecture:** Tres tablas nuevas en Mantenimiento (padrón con vigencia, semana de referencia, pisadas a mano por día). Toda la decisión vive en funciones puras de `lib/mantenimiento/` —el cálculo de los dos ciclos de rotación, el cruce con las ausencias y el filtro de candidatos—, que es lo único que se testea en este repo. Las rutas leen `ausencias` con el cliente admin y devuelven un booleano por persona y día, sin el motivo. El alta de ausencia se saca a `lib/rrhh/` para que la punta de Mantenimiento corra los mismos efectos que la de RRHH.

**Tech Stack:** Next.js 16 (App Router), Supabase (PostgREST + RLS), TypeScript, Vitest, Tailwind v4.

**Spec:** [docs/superpowers/specs/2026-10-22-mantenimiento-disponibilidad-y-turnos-design.md](../specs/2026-10-22-mantenimiento-disponibilidad-y-turnos-design.md)

## Global Constraints

- Todo en **castellano**: nombres, comentarios, mensajes de pantalla y de commit.
- Commits convencionales en castellano: `feat(mantenimiento): …`. El cuerpo explica **por qué**, qué se probó y qué riesgo queda asumido.
- **Nunca `git add -A`.** Agregar por nombre sólo los archivos de la tarea.
- La migración **la corre una persona a mano** en el editor SQL de Supabase. Un agente la escribe y espera. El archivo se crea con `npm run migracion "descripcion corta"` (marca de tiempo, no contador).
- **Una policy nueva llama a su función envuelta**: `using ((select mant_es_admin()))`, nunca pelada.
- Los desplegables se escriben **`<Select>`** de `components/Select.tsx`, no `<select>` nativo.
- **`grid-cols-3` sin breakpoint no entra en 343 px.** Va `grid-cols-1 sm:grid-cols-3`. Una `<table>` necesita contenedor con scroll.
- **`className="input w-20"` no mide 20**: el ancho va en un `div` que envuelva al campo.
- Los turnos son **`4-12`, `8-16`, `12-20`**. El de 20 a 4 no existe en este proyecto.
- Los oficios son **`mecanico`, `electricista`, `lubricador`**. Los grupos, **`A`** (2 mecánicos) y **`B`** (3 mecánicos + 1 lubricador).
- Verificación de cada tarea: `npm test`, `npx tsc --noEmit`. Antes de dar la tarea por buena, `node scripts/revisar-arbol-commiteado.mjs` y, si tocó pantallas, `node scripts/revisar-responsive.mjs`.

## Review Focus

Cinco cosas que el spec implica, que ningún test de tarea ejercita por su cuenta, y que si fallan las sufre una persona. Cada una tiene abajo el test que la fija, en la tarea que es dueña del código.

1. **Una semana anterior a la de referencia.** El módulo de JS con negativos devuelve negativo, así que una semana pasada mostraría el grupo que no es, en silencio. → Tarea 2.
2. **Una ausencia que entra o sale a mitad de semana.** El rango `fecha_desde`/`fecha_hasta` se compara por día, no por semana: una licencia que arranca el jueves no puede vaciar el lunes. → Tarea 3.
3. **Alguien que se fue del taller, o cambió de grupo.** Con vigencia en el padrón, una semana pasada tiene que seguir diciendo lo que decía. → Tarea 3.
4. **Una ausencia en un período ya liquidado.** Hoy nada lo frena; el encargado podría mover una liquidación cerrada sin enterarse. → Tarea 4.
5. **Un candidato que ya está tapando otro hueco ese día.** Sugerirlo dos veces para el mismo turno lo pondría en dos lugares a la vez. → Tarea 3.

---

## Estructura de archivos

| Archivo | De qué es responsable |
|---|---|
| `supabase/migrations/<ts>_mantenimiento_programacion_del_taller.sql` | Las tres tablas, sus policies y el porqué en el encabezado |
| `lib/mantenimiento/programacion.ts` | Los dos ciclos de rotación. Puro. |
| `lib/mantenimiento/disponibilidad.ts` | Cruce con ausencias, vigencia del padrón, candidatos. Puro. |
| `lib/rrhh/altaDeAusencia.ts` | El alta con sus efectos (vacaciones + recálculo) y el freno del período cerrado, compartida por las dos puntas |
| `app/api/rrhh/ausencias/route.ts` | *(modificar)* pasa a usar `lib/rrhh/altaDeAusencia.ts` |
| `app/api/mantenimiento/personal/route.ts` | El padrón del taller |
| `app/api/mantenimiento/programacion/route.ts` | La semana armada: asignaciones, huecos y candidatos |
| `app/api/mantenimiento/programacion/pisadas/route.ts` | Pisar y despisar una asignación de un día |
| `app/api/mantenimiento/ausencias/route.ts` | El alta/corrección de ausencia del encargado, acotada a su padrón |
| `app/(app)/mantenimiento/programacion/page.tsx` · `ProgramacionClient.tsx` | La pantalla |
| `lib/core/nav.ts` | *(modificar)* la entrada del menú, `soloAdmin: true` |

---

### Tarea 1: La migración

**Files:**
- Create: `supabase/migrations/<ts>_mantenimiento_programacion_del_taller.sql` (el nombre lo genera `npm run migracion "programacion del taller"`)

**Interfaces:**
- Produces: las tablas `mant_personal_taller`, `mant_programacion_referencia`, `mant_programacion_pisadas`, que todas las tareas siguientes leen y escriben.

- [ ] **Step 1: Leer las ocho trampas de `supabase/migrations/README.md`**

No hay enum nuevo acá (los oficios y turnos van como `check`, para no gastar la regla del `55P04`), pero el resto aplica.

- [ ] **Step 2: Crear el archivo**

Run: `npm run migracion "programacion del taller"`

- [ ] **Step 3: Escribir el encabezado y el DDL**

El encabezado explica, en castellano: por qué el oficio no va en `empleados` (migración `20260903090920`: son oficios, no sectores), por qué el padrón lleva vigencia (una semana pasada no se reescribe sola) y por qué las pisadas son por día y no por semana (las ausencias son por día).

```sql
create table mant_personal_taller (
  id          uuid primary key default gen_random_uuid(),
  empleado_id uuid not null references empleados(id) on delete cascade,
  oficio      text not null check (oficio in ('mecanico', 'electricista', 'lubricador')),
  -- Sólo los que rotan en bloque. Un electricista no tiene grupo: rota solo.
  grupo       text check (grupo in ('A', 'B')),
  desde       date not null,
  hasta       date,
  created_at  timestamptz not null default now()
);

-- Una sola fila. Fija el lunes desde el que se cuenta y dónde arrancan los dos
-- ciclos: el de los grupos (2 semanas) y el de los electricistas (3).
create table mant_programacion_referencia (
  id                   uuid primary key default gen_random_uuid(),
  lunes                date not null,
  grupo_en_4a12        text not null check (grupo_en_4a12 in ('A', 'B')),
  electricista_4a12_id uuid not null references empleados(id),
  electricista_8a16_id uuid not null references empleados(id),
  electricista_12a20_id uuid not null references empleados(id)
);

-- Lo que el encargado pisó a mano, por día. Lo que no está acá sale del ciclo.
create table mant_programacion_pisadas (
  id          uuid primary key default gen_random_uuid(),
  empleado_id uuid not null references empleados(id) on delete cascade,
  dia         date not null,
  turno       text not null check (turno in ('4-12', '8-16', '12-20')),
  pisado_por_id uuid not null references usuarios(id),
  created_at  timestamptz not null default now(),
  unique (empleado_id, dia)
);
```

El `unique (empleado_id, dia)` es lo que impide que una persona quede en dos turnos el mismo día.

- [ ] **Step 4: RLS en las tres, con la función envuelta**

Las tres llevan `enable row level security` y una policy `for all to authenticated using ((select mant_es_admin())) with check ((select mant_es_admin()))`. El subselect no es cosmético: sin él el `USING` se evalúa una vez por fila.

- [ ] **Step 5: Avisar y quedar a la espera**

Decirle al usuario que la migración está escrita y que hay que correrla a mano en el editor SQL de Supabase, y **no seguir con las tareas que tocan la base hasta que confirme**. Las tareas 2 y 3 son puras y se pueden hacer mientras tanto.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/<ts>_mantenimiento_programacion_del_taller.sql
git commit -m "feat(mantenimiento): tablas de la programacion semanal del taller"
```

---

### Tarea 2: El cálculo de la rotación

**Files:**
- Create: `lib/mantenimiento/programacion.ts`
- Test: `lib/mantenimiento/programacion.test.ts`

**Interfaces:**
- Consumes: `semanaDe(iso, corrimiento)` de `lib/core/fechas.ts` — los siete días de la semana de `iso`, de lunes a domingo.
- Produces:
  ```ts
  export type Turno = "4-12" | "8-16" | "12-20";
  export type Oficio = "mecanico" | "electricista" | "lubricador";
  export type Grupo = "A" | "B";

  export interface Referencia {
    lunes: string;
    grupoEn4a12: Grupo;
    electricistas: Record<Turno, string>; // empleado_id
  }

  export function semanasDesdeLaReferencia(lunesRef: string, lunes: string): number;
  export function turnoDelGrupo(ref: Referencia, lunes: string, grupo: Grupo): Turno;
  export function turnoDelElectricista(ref: Referencia, lunes: string, empleadoId: string): Turno | null;
  ```

- [ ] **Step 1: Escribir los tests que fallan**

El cuadro de seis semanas del spec, tal cual, más la semana anterior a la de referencia.

```ts
const REF: Referencia = {
  lunes: "2026-10-19",
  grupoEn4a12: "A",
  electricistas: { "4-12": "e1", "8-16": "e2", "12-20": "e3" },
};

it("los grupos se dan vuelta cada semana", () => {
  expect(turnoDelGrupo(REF, "2026-10-19", "A")).toBe("4-12");
  expect(turnoDelGrupo(REF, "2026-10-19", "B")).toBe("12-20");
  expect(turnoDelGrupo(REF, "2026-10-26", "A")).toBe("12-20");
  expect(turnoDelGrupo(REF, "2026-11-02", "A")).toBe("4-12");
});

it("el grupo B nunca va a 8 a 16", () => {
  for (let i = 0; i < 6; i++) {
    const lunes = semanaDe(REF.lunes, i)[0];
    expect(turnoDelGrupo(REF, lunes, "B")).not.toBe("8-16");
  }
});

it("cada electricista avanza un turno por semana", () => {
  expect(turnoDelElectricista(REF, "2026-10-19", "e1")).toBe("4-12");
  expect(turnoDelElectricista(REF, "2026-10-26", "e1")).toBe("8-16");
  expect(turnoDelElectricista(REF, "2026-11-02", "e1")).toBe("12-20");
  expect(turnoDelElectricista(REF, "2026-11-09", "e1")).toBe("4-12");
});

it("el cuadro entero se repite recien a las 6 semanas", () => {
  const foto = (lunes: string) => [
    turnoDelGrupo(REF, lunes, "A"),
    turnoDelElectricista(REF, lunes, "e1"),
  ].join("|");
  const semana1 = foto("2026-10-19");
  for (let i = 1; i < 6; i++) {
    expect(foto(semanaDe(REF.lunes, i)[0])).not.toBe(semana1);
  }
  expect(foto(semanaDe(REF.lunes, 6)[0])).toBe(semana1);
});

// Review Focus 1
it("una semana anterior a la referencia no se va a negativo", () => {
  expect(turnoDelGrupo(REF, "2026-10-12", "A")).toBe("12-20");
  expect(turnoDelElectricista(REF, "2026-10-12", "e1")).toBe("12-20");
  expect(semanasDesdeLaReferencia("2026-10-19", "2026-09-21")).toBe(-4);
});

it("alguien que no es electricista de la referencia no tiene turno", () => {
  expect(turnoDelElectricista(REF, "2026-10-19", "e9")).toBeNull();
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run lib/mantenimiento/programacion.test.ts`
Expected: FAIL — los módulos no existen.

- [ ] **Step 3: Implementar las tres funciones en `lib/mantenimiento/programacion.ts`**

`semanasDesdeLaReferencia` devuelve la diferencia en semanas, con signo. Las otras dos avanzan sobre un orden de turnos y **tienen que normalizar el módulo** —`((n % p) + p) % p`— porque el `%` de JavaScript con negativos devuelve negativo y eso es justo lo que rompe las semanas pasadas. El ciclo de los grupos tiene período 2 sobre `["4-12", "12-20"]`; el de los electricistas, período 3 sobre `["4-12", "8-16", "12-20"]`.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run lib/mantenimiento/programacion.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/mantenimiento/programacion.ts lib/mantenimiento/programacion.test.ts
git commit -m "feat(mantenimiento): el calculo de los dos ciclos de rotacion del taller"
```

---

### Tarea 3: El cruce con las ausencias y los candidatos

**Files:**
- Create: `lib/mantenimiento/disponibilidad.ts`
- Test: `lib/mantenimiento/disponibilidad.test.ts`

**Interfaces:**
- Consumes: `Turno`, `Oficio`, `Grupo` de `lib/mantenimiento/programacion.ts`.
- Produces:
  ```ts
  export interface PersonaDelTaller {
    empleadoId: string;
    oficio: Oficio;
    grupo: Grupo | null;
    desde: string;
    hasta: string | null;
  }

  export interface AusenciaCruda {
    empleado_id: string;
    fecha_desde: string;
    fecha_hasta: string;
    tipo: string;
  }

  export interface Asignacion {
    empleadoId: string;
    dia: string;
    turno: Turno;
    pisada: boolean;
  }

  export const TIPOS_QUE_NO_SON_FALTA: readonly string[];

  export function estaVigente(persona: PersonaDelTaller, dia: string): boolean;
  export function estaAusente(ausencias: AusenciaCruda[], empleadoId: string, dia: string): boolean;
  export function candidatosParaElHueco(
    asignaciones: Asignacion[],
    ausentes: (empleadoId: string, dia: string) => boolean,
    padron: PersonaDelTaller[],
    hueco: { dia: string; turno: Turno; oficio: Oficio }
  ): string[];
  ```

- [ ] **Step 1: Escribir los tests que fallan**

```ts
// Review Focus 2
it("una ausencia que arranca el jueves no vacia el lunes", () => {
  const a = [{ empleado_id: "m1", fecha_desde: "2026-10-22", fecha_hasta: "2026-10-30", tipo: "PERMISO_PERSONAL" }];
  expect(estaAusente(a, "m1", "2026-10-19")).toBe(false);
  expect(estaAusente(a, "m1", "2026-10-22")).toBe(true);
  expect(estaAusente(a, "m1", "2026-10-30")).toBe(true);
  expect(estaAusente(a, "m1", "2026-10-31")).toBe(false);
});

it("una tardanza no es una falta", () => {
  const a = [{ empleado_id: "m1", fecha_desde: "2026-10-19", fecha_hasta: "2026-10-19", tipo: "TARDANZA" }];
  expect(estaAusente(a, "m1", "2026-10-19")).toBe(false);
});

it("una ausencia injustificada si lo es", () => {
  const a = [{ empleado_id: "m1", fecha_desde: "2026-10-19", fecha_hasta: "2026-10-19", tipo: "INJUSTIFICADA" }];
  expect(estaAusente(a, "m1", "2026-10-19")).toBe(true);
});

// Review Focus 3
it("alguien que se fue no esta vigente despues de su ultimo dia", () => {
  const p = { empleadoId: "m1", oficio: "mecanico", grupo: "A", desde: "2026-01-01", hasta: "2026-10-20" } as const;
  expect(estaVigente(p, "2026-10-20")).toBe(true);
  expect(estaVigente(p, "2026-10-21")).toBe(false);
  expect(estaVigente(p, "2025-12-31")).toBe(false);
});

it("sugiere del mismo oficio y que no este ya en ese turno", () => { /* el hueco de un mecanico no propone al electricista, ni a quien ya esta en 4-12 ese dia */ });

it("no sugiere a quien esta ausente ese dia", () => { /* … */ });

// Review Focus 5
it("no sugiere a quien ya fue movido a ese turno ese dia", () => { /* una asignacion con pisada: true cuenta igual que una del ciclo */ });

it("sugiere a alguien del otro turno aunque eso deje corto al suyo", () => { /* el spec lo pide explicitamente: no se filtra por eso */ });
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run lib/mantenimiento/disponibilidad.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar en `lib/mantenimiento/disponibilidad.ts`**

`TIPOS_QUE_NO_SON_FALTA` es `["TARDANZA"]` y el comentario dice por qué: el que llega tarde viene a trabajar, y pintarlo como hueco es el anti-objetivo del spec. Las fechas son ISO `YYYY-MM-DD`, así que se comparan como strings. `candidatosParaElHueco` filtra el padrón por oficio y vigencia, saca a los ausentes y a los que ya tienen una asignación en ese turno y día, y **no** mira qué turno queda corto.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run lib/mantenimiento/disponibilidad.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/mantenimiento/disponibilidad.ts lib/mantenimiento/disponibilidad.test.ts
git commit -m "feat(mantenimiento): cruce de ausencias y candidatos para tapar el hueco"
```

---

### Tarea 4: El alta de ausencia, compartida por las dos puntas

**Files:**
- Create: `lib/rrhh/altaDeAusencia.ts`
- Test: `lib/rrhh/altaDeAusencia.test.ts`
- Modify: `app/api/rrhh/ausencias/route.ts`

**Interfaces:**
- Produces:
  ```ts
  export const TIPOS_DEL_ENCARGADO: readonly string[];
  export function periodoEstaCerrado(liquidaciones: { periodo_desde: string; periodo_hasta: string; estado: string }[], fecha: string): boolean;
  export async function altaDeAusencia(supabase, datos: DatosDeAusencia): Promise<{ ausencia?: unknown; error?: string; status?: number }>;
  ```

**Por qué esta tarea existe:** `POST /api/rrhh/ausencias` no se limita a insertar — llama a `sincronizarPeriodoVacaciones()` y a `recalcularEmpleadoPeriodo()`. Si la punta de Mantenimiento se saltea eso, la fila existe pero la liquidación no la ve. El cuerpo se saca acá y lo usan las dos.

- [ ] **Step 1: Escribir los tests que fallan**

Puros, sobre las dos funciones que no tocan la base:

```ts
// Review Focus 4
it("una fecha dentro de una liquidacion cerrada esta cerrada", () => {
  const liq = [{ periodo_desde: "2026-09-01", periodo_hasta: "2026-09-30", estado: "CERRADA" }];
  expect(periodoEstaCerrado(liq, "2026-09-15")).toBe(true);
  expect(periodoEstaCerrado(liq, "2026-10-01")).toBe(false);
});

it("una liquidacion en borrador no cierra nada", () => {
  const liq = [{ periodo_desde: "2026-09-01", periodo_hasta: "2026-09-30", estado: "BORRADOR" }];
  expect(periodoEstaCerrado(liq, "2026-09-15")).toBe(false);
});

it("el encargado no puede elegir vacaciones ni ART", () => {
  expect(TIPOS_DEL_ENCARGADO).toEqual(
    ["PERMISO_PERSONAL", "ENFERMEDAD_ACCIDENTE_INCULPABLE", "INJUSTIFICADA", "OTRA"]
  );
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run lib/rrhh/altaDeAusencia.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar `lib/rrhh/altaDeAusencia.ts`**

`altaDeAusencia` mueve el cuerpo que hoy vive en el `POST` de `app/api/rrhh/ausencias/route.ts`: la validación de tipo, la regla de `OTRA` (pide observaciones) y la de `VACACIONES` (pide `anioCorrespondiente`), el `insert`, `sincronizarPeriodoVacaciones()` y `recalcularEmpleadoPeriodo()`. Devuelve `{ error, status }` en vez de un `NextResponse`, para que las dos rutas armen su respuesta.

- [ ] **Step 4: Cambiar `app/api/rrhh/ausencias/route.ts` para que la use**

El `POST` queda con el chequeo de permiso y la llamada. **No cambiar los mensajes de error**: los de hoy están en castellano y son mejores que cualquier cosa genérica, y ésa es la vara del proyecto.

- [ ] **Step 5: Correr toda la suite**

Run: `npm test` y `npx tsc --noEmit`
Expected: PASS — nada de RRHH se movió de lugar.

- [ ] **Step 6: Commit**

```bash
git add lib/rrhh/altaDeAusencia.ts lib/rrhh/altaDeAusencia.test.ts app/api/rrhh/ausencias/route.ts
git commit -m "feat(rrhh): el alta de ausencia sale de la ruta a lib para compartirla"
```

---

### Tarea 5: Las rutas de la programación

**Files:**
- Create: `app/api/mantenimiento/personal/route.ts`
- Create: `app/api/mantenimiento/programacion/route.ts`
- Create: `app/api/mantenimiento/programacion/pisadas/route.ts`

**Interfaces:**
- Consumes: todo lo de las tareas 2 y 3; `esAdminMantenimiento()` de `lib/mantenimiento/auth.ts`; `createAdminClient()` de `lib/supabase/admin`.
- Produces: `GET /api/mantenimiento/programacion?lunes=YYYY-MM-DD` devuelve
  ```ts
  {
    dias: string[];                    // los siete, de lunes a domingo
    asignaciones: Asignacion[];
    ausentes: { empleadoId: string; dia: string }[];   // sin el motivo
    candidatos: Record<string, string[]>;              // "dia|turno|oficio" -> empleadoId[]
    personas: { empleadoId: string; nombre: string; oficio: Oficio; grupo: Grupo | null }[];
    sinReferencia?: true;
  }
  ```

**Depende de la tarea 1 aplicada.** No empezar hasta que el usuario confirme que corrió la migración.

- [ ] **Step 1: `app/api/mantenimiento/personal/route.ts`**

`GET` devuelve el padrón vigente con el nombre del empleado embebido; `POST` suma una persona; `PATCH` le pone `hasta` o le cambia el grupo. Las tres piden `esAdminMantenimiento`. El `select` va **literal en la cadena**, no armado en una variable, o se pierde la inferencia de tipos de Supabase.

- [ ] **Step 2: `app/api/mantenimiento/programacion/route.ts`**

Lee la referencia, el padrón y las pisadas de esa semana; arma las asignaciones con `turnoDelGrupo`/`turnoDelElectricista` para los vigentes y deja que las pisadas ganen sobre el ciclo. Lee `ausencias` **con el cliente admin** —`ausencias` está cerrada con `tiene_acceso_rrhh()` y no se abre ninguna policy nueva— y **devuelve sólo `empleadoId` y `dia`, nunca el `tipo`**: el motivo es dato médico y disciplinario, y el spec lo deja afuera a propósito. Si no hay fila en `mant_programacion_referencia`, devuelve `{ sinReferencia: true }` en vez de 500.

- [ ] **Step 3: `app/api/mantenimiento/programacion/pisadas/route.ts`**

`POST` escribe `(empleado_id, dia, turno)` con `onConflict: "empleado_id,dia"`; `DELETE` la saca y el día vuelve al ciclo. El `unique (empleado_id, dia)` de la tabla es lo que impide ponerlo en dos turnos a la vez — es un índice único completo, no parcial, así que sirve como destino de `ON CONFLICT`.

- [ ] **Step 4: Ejercitar las tres contra la base real**

Con el `SUPABASE_SERVICE_ROLE_KEY` de `.env.local`, cargar el padrón de prueba y pedir una semana. Leer el modelo no alcanza: correr la operación que el encargado va a correr.

- [ ] **Step 5: Commit**

```bash
git add app/api/mantenimiento/personal/route.ts app/api/mantenimiento/programacion/route.ts app/api/mantenimiento/programacion/pisadas/route.ts
git commit -m "feat(mantenimiento): rutas del padron, la semana y las pisadas a mano"
```

---

### Tarea 6: La ausencia cargada por el encargado

**Files:**
- Create: `app/api/mantenimiento/ausencias/route.ts`

**Interfaces:**
- Consumes: `altaDeAusencia()`, `TIPOS_DEL_ENCARGADO` y `periodoEstaCerrado()` de la tarea 4; `puedeEditarMantenimiento()` de `lib/mantenimiento/auth.ts`.

- [ ] **Step 1: `POST`**

Dos chequeos antes de escribir, y los dos son el permiso: que tenga **nivel de edición en Mantenimiento**, y que el `empleadoId` esté **en `mant_personal_taller` y vigente**. Puede anotar la falta de uno de sus nueve y de nadie más. El `tipo` tiene que estar en `TIPOS_DEL_ENCARGADO`; si no, 400 con un mensaje que diga que ése lo carga RRHH. Si la fecha cae en un período cerrado, 400 diciendo que eso lo tiene que ver RRHH. Escribe con el cliente admin y `cargado_por_id` es el usuario de la sesión.

- [ ] **Step 2: `PATCH` y `DELETE`**

Sólo sobre ausencias cuyo `cargado_por_id` sea el usuario que pide, de alguien de su padrón, y con el período abierto. Lo que cargó RRHH no lo toca.

- [ ] **Step 3: Ejercitar el camino completo contra la base real**

Cargar una ausencia desde esta ruta y comprobar que `calculos_diarios` del período se recalculó — que es la razón de ser de la tarea 4.

- [ ] **Step 4: Commit**

```bash
git add app/api/mantenimiento/ausencias/route.ts
git commit -m "feat(mantenimiento): el encargado anota la falta de uno de los suyos"
```

---

### Tarea 7: La pantalla

**Files:**
- Create: `app/(app)/mantenimiento/programacion/page.tsx`
- Create: `app/(app)/mantenimiento/programacion/ProgramacionClient.tsx`
- Modify: `lib/core/nav.ts`

- [ ] **Step 1: `page.tsx`**

Server Component: `getUser()`, y si no es `esAdminMantenimiento` redirige a `/mantenimiento`. Mismo molde que `app/(app)/rrhh/turnos/page.tsx`.

- [ ] **Step 2: `ProgramacionClient.tsx`**

Carga con `useCargar`. Tres turnos por siete días. Abre en la semana en curso —`semanaDe(hoyEnArgentina())`— con adelante y atrás. Cada hueco muestra **que la persona no está, nunca por qué**, y al lado los candidatos. Desde el hueco, o desde una persona del día, se carga la ausencia en dos toques: ése es el camino principal por el que entra el dato, no un formulario escondido. Si la respuesta trae `sinReferencia`, la pantalla dice que falta cargar la semana de referencia y ofrece hacerlo, en vez de dibujar una grilla vacía.

Las tres reglas que no rompen nada y por eso muerden: los desplegables son `<Select>`; la grilla va `grid-cols-1 sm:grid-cols-3` y la tabla dentro de un contenedor con scroll; y un `w-*` sobre un `.input` no mide lo que dice — el ancho va en un `div` que lo envuelva.

- [ ] **Step 3: La entrada del menú**

En `lib/core/nav.ts`, dentro de los `children` de Mantenimiento, debajo de Planificación:

```ts
{ label: "Programación", href: "/mantenimiento/programacion", modulo: "mantenimiento", soloAdmin: true },
```

`soloAdmin: true` es lo que cumple el "no la ve nadie más" del spec, con el alcance que el spec ya dejó escrito: la ve todo el que tenga admin de Mantenimiento.

- [ ] **Step 4: Verificar**

Run: `npm test`, `npx tsc --noEmit`, `node scripts/revisar-responsive.mjs`
Expected: tests y tipos en verde; el responsive da **ROMPE 0 · APRETADO 0 · MIRAR 0** — cualquier cosa que aparezca es de lo que se acaba de escribir.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/mantenimiento/programacion/page.tsx" "app/(app)/mantenimiento/programacion/ProgramacionClient.tsx" lib/core/nav.ts
git commit -m "feat(mantenimiento): la pantalla de la programacion semanal del taller"
```

---

### Tarea 8: Cierre

- [ ] **Step 1: Verificación completa**

Run: `npm test`, `npx tsc --noEmit`, `npm run build` (con el dev server parado: un `next build` con `npm run dev` levantado deja la app en 500), `node scripts/revisar-arbol-commiteado.mjs`

- [ ] **Step 2: Documentar**

Sumar la programación a `docs/MANTENIMIENTO-INTEGRACION.md` y la fila del módulo en la tabla de `CLAUDE.md`, con las dos cosas que no se deducen del código: que `francos` queda afuera del cruce a propósito y por qué, y que el ciclo entero recién se repite a las 6 semanas.

- [ ] **Step 3: Pushear**

Se trabaja sobre `main` y se pushea al terminar la tarea. Antes, `git status`: puede haber otra sesión en el mismo árbol, y pushear arrastra lo que esa sesión dejó sin pushear — a quién se publica lo decide el usuario.
