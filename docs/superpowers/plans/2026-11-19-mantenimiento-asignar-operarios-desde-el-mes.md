# Asignar operarios desde el mes — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que en la pestaña «Mes» de «Asignación RR.HH» se vea la rotación del
taller semana por semana, y que desde el panel de un día se le puedan poner
operarios a una OT abierta de ese día.

**Architecture:** La lógica pura va a tres módulos nuevos de `lib/mantenimiento/`
con tests; una ruta nueva guardada con `esAdminMantenimiento` la sirve (los
nombres **no** pueden viajar por `/api/mantenimiento/calendario`, que está
abierta y la montan tres pantallas); y `CalendarioDeOT` gana dos piezas
opcionales que sólo `/programacion` le pasa. Guardar reusa el PATCH de
`/api/mantenimiento/ordenes`, que ya manda `operario_1/2/3` a la tabla y a las
columnas P/Q/R del master. **No hay migración.**

**Tech Stack:** Next.js 16 (App Router), React, Supabase/PostgREST, Tailwind v4,
vitest. Todo en castellano.

**Spec:** [docs/superpowers/specs/2026-11-19-mantenimiento-asignar-operarios-desde-el-mes-design.md](../specs/2026-11-19-mantenimiento-asignar-operarios-desde-el-mes-design.md)

## Global Constraints

- **Castellano** en nombres, comentarios, mensajes de pantalla y de commit.
- **Nunca `git add -A`**: se agregan los archivos tocados, por nombre.
- **Los nombres de personas no salen por `/api/mantenimiento/calendario`.** Esa
  ruta sigue devolviendo sólo conteos por oficio.
- **El `tipo` de una ausencia no se expone nunca.** Sólo «falta» o «de franco».
- **Un desplegable se escribe `<Select>`** (`components/Select.tsx`), no `<select>`.
- **Una grilla de tres o más columnas lleva breakpoint**: `grid-cols-1 sm:grid-cols-3`.
  El ancho útil del teléfono es 343 px.
- **`className="input w-20"` no mide 20**: el ancho va en un `div` que envuelva
  al campo.
- **Un modal se escribe `<Modal>`** (`components/Modal.tsx`), no `fixed inset-0`.
- **PostgREST corta en 1000 filas sin avisar**: `traerTodo()` de `lib/core/paginado.ts`.
- **Un `select()` armado en una variable pierde los tipos**: la cadena va literal.
- **Un fallo de escritura en la planilla se le dice a quien hizo la acción, con
  lo que dijo Google y sin traducir.**
- Las rutas y las pantallas **no tienen tests** en este repo: lo que decide algo
  se saca a `lib/` y se prueba ahí.

## Review Focus

Lo que el spec implica y ningún test de tarea ejercita por su cuenta:

1. **Una semana sin referencia del ciclo** (`mant_programacion_referencia`
   vacía): la franja tiene que decir que falta la referencia, y **la asignación
   tiene que seguir andando**. Test en la Tarea 1.
2. **Un nombre del catálogo que cae en dos personas del padrón** («Lucas» →
   Gallastegui y Mendizábal): se ofrece y dice que no se sabe su
   disponibilidad, nunca elige una. Test en la Tarea 2.
3. **Una persona con dos filas de padrón vigentes el mismo día** (cambio de
   grupo a mitad de semana): aparece una sola vez en la franja. Test en la
   Tarea 1.
4. **Una orden de arrastre** (`arrastre: true`, el día que se mira no es su
   inicio): se le puede asignar igual que a cualquier otra — lo que decide es
   el estado y nada más—, y el turno y la falta se calculan contra el día que
   se mira. Test en la Tarea 3.
5. **La tercera posición ya ocupada**: el cuarto nombre lo dice en vez de pisar
   al tercero. Test en la Tarea 3.

---

## Mapa de archivos

| Archivo | De qué se hace cargo |
|---|---|
| `lib/mantenimiento/rotacionDeLaSemana.ts` **(nuevo)** | La franja de una semana: quién está en cada turno por el ciclo, quién falta algún día, cuántos días llevan pisada |
| `lib/mantenimiento/operarioDelCatalogo.ts` **(nuevo)** | Resolver un `nombre` del catálogo `operarios` a una persona del padrón, o decir por qué no se puede |
| `lib/mantenimiento/asignarOperario.ts` **(nuevo)** | Qué órdenes admiten asignación, en qué posición entra un nombre, y qué cuerpo se le manda al PATCH |
| `app/api/mantenimiento/taller-del-mes/route.ts` **(nuevo)** | Sirve lo anterior para un rango de días, con `esAdminMantenimiento` |
| `app/(app)/mantenimiento/ordenes/FranjaDelTaller.tsx` **(nuevo)** | Dibuja la franja de una semana. **Se llama así y no `FranjaDeLaSemana` a propósito**: ése es el nombre del tipo que importa, y un componente homónimo de su propio tipo no se puede importar junto a él |
| `app/(app)/mantenimiento/ordenes/AsignarOperariosModal.tsx` **(nuevo)** | El panel que pone y saca operarios de una OT |
| `app/(app)/mantenimiento/ordenes/CalendarioDeOT.tsx` | La grilla pasa a dibujarse semana por semana, con la franja opcional arriba de cada una |
| `app/(app)/mantenimiento/ordenes/MesDeOrdenes.tsx` | Trae el taller del mes y reparte la franja y el panel |
| `app/(app)/mantenimiento/programacion/ProgramacionClient.tsx` | Le pide a `MesDeOrdenes` la franja y la asignación (es la pantalla de admin) |

---

### Task 1: La rotación de una semana, con nombres

**Files:**
- Create: `lib/mantenimiento/rotacionDeLaSemana.ts`
- Test: `lib/mantenimiento/rotacionDeLaSemana.test.ts`

**Interfaces:**
- Consumes: `laQueRige`, `comoReferencia`, `turnoDeLaPersona`, `type FilaDeReferencia`
  de `lib/mantenimiento/referenciaDelTaller.ts`; `estaVigente`, `noViene`,
  `type PersonaDelTaller`, `type AusenciaCruda`, `type FrancoCrudo` de
  `lib/mantenimiento/disponibilidad.ts`; `type Turno`, `type Oficio` de
  `lib/mantenimiento/programacion.ts`; `semanaDe` de `lib/core/fechas.ts`.
- Produces:

```ts
export interface EnLaFranja {
  empleadoId: string;
  nombre: string;
  oficio: Oficio;
  /** Los días de esa semana en que no viene. Vacío si viene todos. */
  diasQueFalta: string[];
}

export interface FranjaDeLaSemana {
  lunes: string;
  /** null cuando no hay referencia que rija: no hay ciclo que mostrar. */
  porTurno: Record<Turno, EnLaFranja[]> | null;
  /** En el padrón esa semana pero sin turno del ciclo. Nunca se esconden. */
  sinTurno: EnLaFranja[];
  /** Cuántos días de la semana tienen al menos una pisada. */
  diasConPisada: number;
}

export function franjaDeLaSemana(
  lunes: string,
  padron: PersonaDelTaller[],
  nombres: Map<string, string>,
  referencias: FilaDeReferencia[],
  ausencias: AusenciaCruda[],
  francos: FrancoCrudo[],
  pisadas: { empleado_id: string; dia: string }[],
): FranjaDeLaSemana
```

- [ ] **Step 1: Escribir los tests que fallan**

En `lib/mantenimiento/rotacionDeLaSemana.test.ts`, con un padrón de prueba de
dos mecánicos (grupo A y B), un lubricador (grupo A) y tres electricistas, y una
referencia con `lunes: "2026-11-09"` y `grupoEn4a12: "A"`:

```ts
it("reparte a cada uno en el turno que le da el ciclo esa semana", () => {
  const f = franjaDeLaSemana("2026-11-09", padron, nombres, [ref], [], [], []);
  expect(f.porTurno!["4-12"].map((p) => p.nombre).sort()).toEqual([...]);
});

it("la semana siguiente los grupos estan dados vuelta", () => { ... });

it("sin ninguna referencia, porTurno es null y sinTurno trae a todos", () => {
  const f = franjaDeLaSemana("2026-11-09", padron, nombres, [], [], [], []);
  expect(f.porTurno).toBeNull();
  expect(f.sinTurno).toHaveLength(padron.length);
});

it("un mecanico sin grupo queda en sinTurno y no desaparece", () => { ... });

it("una ausencia marca solo los dias que toca, no la semana entera", () => {
  // ausencia 2026-11-10 → 2026-11-11
  expect(persona.diasQueFalta).toEqual(["2026-11-10", "2026-11-11"]);
});

it("una TARDANZA no cuenta como falta", () => { ... });

it("un franco sin fecha_descanso no abre hueco", () => { ... });

it("dos filas de padron vigentes el mismo dia dan una sola persona", () => {
  // misma empleadoId, grupo A hasta el miércoles y grupo B desde el jueves
  const todos = Object.values(f.porTurno!).flat().concat(f.sinTurno);
  expect(todos.filter((p) => p.empleadoId === "e1")).toHaveLength(1);
});

it("cuenta los dias con pisada, sin importar cuantas pisadas tenga cada dia", () => {
  const f = franjaDeLaSemana("2026-11-09", padron, nombres, [ref], [], [], [
    { empleado_id: "e1", dia: "2026-11-10" },
    { empleado_id: "e2", dia: "2026-11-10" },
    { empleado_id: "e1", dia: "2026-11-12" },
  ]);
  expect(f.diasConPisada).toBe(2);
});
```

- [ ] **Step 2: Correrlos y ver que fallan**

Run: `npx vitest run lib/mantenimiento/rotacionDeLaSemana.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar `franjaDeLaSemana` en `lib/mantenimiento/rotacionDeLaSemana.ts`**

El turno sale de `turnoDeLaPersona(comoReferencia(laQueRige(referencias, lunes)), lunes, persona)`.
**La franja es el ciclo y no mira las pisadas para ubicar a nadie** —sólo las
cuenta—, porque una pisada es de un día y la franja es de una semana; el turno
real de un día lo resuelve la Tarea 3. El encabezado del archivo tiene que
decir eso y por qué, y que `porTurno: null` no es «no hay nadie» sino «no hay
ciclo».

- [ ] **Step 4: Correrlos y ver que pasan**

Run: `npx vitest run lib/mantenimiento/rotacionDeLaSemana.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/mantenimiento/rotacionDeLaSemana.ts lib/mantenimiento/rotacionDeLaSemana.test.ts
git commit -m "feat(mantenimiento): la rotacion de una semana con nombres"
```

---

### Task 2: De un nombre del catálogo a una persona

**Files:**
- Create: `lib/mantenimiento/operarioDelCatalogo.ts`
- Test: `lib/mantenimiento/operarioDelCatalogo.test.ts`

**Interfaces:**
- Consumes: `norm` de `lib/core/texto.ts`; `type PersonaDelTaller` de `disponibilidad.ts`.
- Produces:

```ts
/** Por qué no se puede saber la disponibilidad de un nombre del catálogo. */
export type PorQueNoSeSabe = "no-esta-en-el-padron" | "nombra-a-mas-de-uno";

export interface OperarioDelCatalogo {
  /** Lo que se escribe en la celda, tal cual sale del catálogo. */
  nombre: string;
  /** 1, 2 o 3: la columna en la que ese nombre puede ir. */
  slot: number;
  /** La persona del padrón, o null con el motivo al lado. */
  empleadoId: string | null;
  porQueNoSeSabe: PorQueNoSeSabe | null;
}

export function resolverElCatalogo(
  catalogo: { slot: number; nombre: string }[],
  padron: PersonaDelTaller[],
  nombres: Map<string, string>,
): OperarioDelCatalogo[]
```

- [ ] **Step 1: Escribir los tests que fallan**

Con el padrón y los nombres reales medidos el 19/11/2026:

```ts
it("resuelve los ocho nombres que caen en una sola persona", () => {
  // Agosta, Aguirre, Echeverria, Garcia, Mendizabal, Picart, Piparo
  expect(porNombre("Piparo").empleadoId).toBe(idDePiparo);
  expect(porNombre("Piparo").porQueNoSeSabe).toBeNull();
});

it("«Lucas» nombra a Gallastegui y a Mendizabal, asi que no elige ninguno", () => {
  expect(porNombre("Lucas").empleadoId).toBeNull();
  expect(porNombre("Lucas").porQueNoSeSabe).toBe("nombra-a-mas-de-uno");
});

it("«Lopez» no esta en el padron, y se ofrece igual", () => {
  expect(porNombre("Lopez").empleadoId).toBeNull();
  expect(porNombre("Lopez").porQueNoSeSabe).toBe("no-esta-en-el-padron");
});

it("«Ambos» no es una persona y sale como que no esta en el padron", () => { ... });

it("conserva el slot y el nombre tal cual, sin tocarles una letra", () => {
  expect(resolverElCatalogo([{ slot: 3, nombre: "Piparo" }], padron, nombres)[0])
    .toMatchObject({ nombre: "Piparo", slot: 3 });
});

it("compara sin tildes ni mayusculas", () => {
  // «Echeverria» contra «NESTOR DANIEL ECHEVERRÍA»
});
```

- [ ] **Step 2: Correrlos y ver que fallan**

Run: `npx vitest run lib/mantenimiento/operarioDelCatalogo.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar `resolverElCatalogo` en `lib/mantenimiento/operarioDelCatalogo.ts`**

Un nombre resuelve cuando `norm(nombreCompletoDelEmpleado)` **contiene**
`norm(nombreDelCatalogo)` para **exactamente una** persona del padrón. Dos o más
→ `"nombra-a-mas-de-uno"`; cero → `"no-esta-en-el-padron"`.

El encabezado del archivo tiene que dejar escrito lo medido el 19/11/2026: **8
de los 10 nombres resuelven solos**, y los otros tres casos se cierran con datos
y no con código (cargar a López en el padrón, desambiguar «Lucas» en el
catálogo). Y por qué no se elige: enlazar al que se le parece es peor que dejar
en null.

- [ ] **Step 4: Correrlos y ver que pasan**

Run: `npx vitest run lib/mantenimiento/operarioDelCatalogo.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/mantenimiento/operarioDelCatalogo.ts lib/mantenimiento/operarioDelCatalogo.test.ts
git commit -m "feat(mantenimiento): resolver un nombre del catalogo de operarios"
```

---

### Task 3: Qué orden admite asignación, y en qué posición entra un nombre

**Files:**
- Create: `lib/mantenimiento/asignarOperario.ts`
- Test: `lib/mantenimiento/asignarOperario.test.ts`

**Interfaces:**
- Consumes: `type OperarioDelCatalogo` de la Tarea 2; `type Turno` de `programacion.ts`.
- Produces:

```ts
export interface OrdenQueSeAsigna {
  estado: string | null;
  operario_1: string | null;
  operario_2: string | null;
  operario_3: string | null;
}

/** El motivo por el que no se le puede asignar, o null si se puede. */
export function porQueNoSePuedeAsignar(o: OrdenQueSeAsigna): string | null;

/** El motivo por el que ese nombre no entra en esa orden, o null si entra. */
export function porQueNoEntra(
  o: OrdenQueSeAsigna,
  operario: OperarioDelCatalogo,
): string | null;

/** El cuerpo del PATCH que pone ese nombre, o que vacía esa posición. */
export function elCuerpoDeLaAsignacion(
  id: string,
  slot: number,
  nombre: string | null,
): Record<string, unknown>;

/** El turno real de una persona un día: la pisada si la hay, si no el ciclo. */
export function turnoDelDia(
  delCiclo: Turno | null,
  pisada: Turno | null,
): Turno | null;
```

- [ ] **Step 1: Escribir los tests que fallan**

```ts
it("una orden abierta se puede asignar", () => {
  expect(porQueNoSePuedeAsignar({ estado: "POR_HACER", ...vacios })).toBeNull();
});

it("una REALIZADO no, y dice que ahi ya dice quien lo hizo", () => {
  expect(porQueNoSePuedeAsignar({ estado: "REALIZADO", ...vacios }))
    .toContain("ya dice quién lo hizo");
});

it("una CANCELADA tampoco", () => { ... });

it("un nombre entra en su propia posicion", () => {
  expect(porQueNoEntra(vacia, { nombre: "Piparo", slot: 3, ... })).toBeNull();
});

it("si esa posicion ya tiene a alguien, lo dice en vez de pisarlo", () => {
  expect(porQueNoEntra({ ...vacia, operario_3: "Picart" }, piparoSlot3))
    .toContain("Picart");
});

it("el mismo nombre dos veces no entra", () => {
  expect(porQueNoEntra({ ...vacia, operario_3: "Piparo" }, piparoSlot3))
    .toContain("ya está");
});

it("el cuerpo nombra la columna del slot", () => {
  expect(elCuerpoDeLaAsignacion("abc", 2, "Garcia"))
    .toEqual({ id: "abc", operario_2: "Garcia" });
});

it("sacar manda la columna vacia y no la omite", () => {
  expect(elCuerpoDeLaAsignacion("abc", 2, null))
    .toEqual({ id: "abc", operario_2: "" });
});

it("la pisada gana sobre el ciclo, y sin pisada manda el ciclo", () => {
  expect(turnoDelDia("4-12", "12-20")).toBe("12-20");
  expect(turnoDelDia("4-12", null)).toBe("4-12");
  expect(turnoDelDia(null, null)).toBeNull();
});

// Una orden de arrastre no es un caso aparte: lo que decide es el estado.
it("lo unico que decide si se puede asignar es el estado", () => {
  const abierta = { estado: "EN_PROCESO", ...vacios };
  expect(porQueNoSePuedeAsignar(abierta)).toBeNull();
  expect(porQueNoSePuedeAsignar({ ...abierta, operario_1: "Aguirre" })).toBeNull();
});
```

- [ ] **Step 2: Correrlos y ver que fallan**

Run: `npx vitest run lib/mantenimiento/asignarOperario.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar las cuatro funciones en `lib/mantenimiento/asignarOperario.ts`**

`elCuerpoDeLaAsignacion` manda **`""` y no `null`** para vaciar: lo que decide
en `repartirRegistroDeOT` es que la clave venga, y el `texto()` de ahí convierte
el vacío en `null` para la tabla y en celda vacía para la planilla.

El encabezado tiene que dejar escritas tres cosas que no se deducen del código:
**una orden cerrada no se asigna** porque esos campos ya dicen quién lo hizo
—643 de las últimas 1.000 los tienen—; **a una orden de arrastre sí se le
asigna**, y el turno y la falta se calculan contra el día que se está mirando y
no contra el inicio de la orden; y que **sacar un operario sólo pega si la
escritura en la planilla anduvo** —la cola se rearma desde la fila y ahí un
vaciado no se distingue de un campo que nunca se llenó—, por lo que el fallo se
le dice a la persona.

- [ ] **Step 4: Correrlos y ver que pasan**

Run: `npx vitest run lib/mantenimiento/asignarOperario.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/mantenimiento/asignarOperario.ts lib/mantenimiento/asignarOperario.test.ts
git commit -m "feat(mantenimiento): las reglas de asignar un operario a una OT"
```

---

### Task 4: La ruta del taller del mes

**Files:**
- Create: `app/api/mantenimiento/taller-del-mes/route.ts`

**Interfaces:**
- Consumes: las tres tareas anteriores; `esAdminMantenimiento` de
  `lib/mantenimiento/auth.ts`; `createClient`/`createAdminClient`; `traerTodo`;
  `esFechaIso`, `sumarDias`, `semanaDe` de `lib/core/fechas.ts`.
- Produces, como JSON:

```ts
{
  franjas: FranjaDeLaSemana[],          // una por semana que toca el rango
  catalogo: OperarioDelCatalogo[],      // los 10, con slot y resolución
  /** Por día, quién no viene: para la lista de asignación. */
  noVienen: Record<string, string[]>,   // "YYYY-MM-DD" → empleadoId[]
  /** Por día y persona, el turno real (pisada encima del ciclo). */
  turnos: Record<string, Turno>,        // "empleadoId|YYYY-MM-DD" → turno
}
```

- [ ] **Step 1: Escribir la ruta**

`GET ?desde=&hasta=`, los dos `AAAA-MM-DD`, con el mismo tope de 62 días que
`app/api/mantenimiento/calendario/route.ts`. Guardada con
**`esAdminMantenimiento`** y no con `puedeVerMantenimiento`: acá salen nombres.

Lee con el cliente admin, igual que la ruta de programación y por el mismo
motivo (`mant_personal_taller`, `ausencias` y `francos` están cerradas), y
**una sola vez para todo el rango**: `mant_personal_taller`, `empleados` (sólo
`id, nombre, apellido` de los del padrón), `mant_programacion_referencia`,
`ausencias`, `francos` —por `fecha_descanso`, `estado = TOMADO`—,
`mant_programacion_pisadas` y `operarios`. Todas con `traerTodo()`.

De `ausencias` entra **sólo** `empleado_id, fecha_desde, fecha_hasta, tipo`, y
el `tipo` se usa para descartar la `TARDANZA` y **se tira antes del JSON**: es
la misma regla que ya cumplen la ruta de programación y la de disponibilidad.

- [ ] **Step 2: Comprobar que contesta y que no filtra**

Run: `NODE_OPTIONS=--max-old-space-size=8192 npm run build`
Expected: compila.

Y a ojo sobre el archivo: que `tipo` no aparezca en ningún `NextResponse.json`.

- [ ] **Step 3: Comprobar contra producción que la franja dice lo mismo que la semana**

Escribir `scripts/comparar-franja-con-la-semana.mts` (lee `.env.local` como
`scripts/calibrar-sospecha-de-cambio.mts`): para cuatro semanas seguidas,
calcular `franjaDeLaSemana` y contrastarla contra el **ciclo** que calcula la
pestaña Semana —`turnoDeLaPersona` sobre el mismo padrón y la misma
referencia—, no contra su grilla final, que lleva las pisadas encima.

Run: `npx tsx scripts/comparar-franja-con-la-semana.mts`
Expected: cero diferencias.

- [ ] **Step 4: Commit**

```bash
git add app/api/mantenimiento/taller-del-mes/route.ts scripts/comparar-franja-con-la-semana.mts
git commit -m "feat(mantenimiento): la ruta del taller del mes, con nombres y solo para admin"
```

---

### Task 5: La franja en la grilla del mes

**Files:**
- Create: `app/(app)/mantenimiento/ordenes/FranjaDelTaller.tsx`
- Modify: `app/(app)/mantenimiento/ordenes/CalendarioDeOT.tsx`
- Modify: `app/(app)/mantenimiento/ordenes/MesDeOrdenes.tsx`
- Modify: `app/(app)/mantenimiento/programacion/ProgramacionClient.tsx`

**Interfaces:**
- Consumes: `type FranjaDeLaSemana` de la Tarea 1; la ruta de la Tarea 4.
- Produces: `CalendarioDeOT` acepta una prop nueva **opcional**

```ts
  /**
   * Qué dibujar arriba de cada semana, por lunes. Opcional y sin default: las
   * tres pantallas que montan este calendario reparten permisos distintos y
   * sólo `/programacion` tiene los nombres.
   */
  franjaDeLaSemana?: (lunes: string) => React.ReactNode;
```

y `MesDeOrdenes` acepta `puedeAsignar: boolean` —obligatoria y sin default, por
la misma razón que ya tiene escrita `puedeMover`—.

- [ ] **Step 1: Partir la grilla en semanas**

Hoy `CalendarioDeOT` dibuja `semanas.flat()` en una sola grilla de siete
columnas. Pasa a dibujar, por cada fila de `semanas`: la franja (si la prop
vino) y después su grilla de siete columnas. Los encabezados `Lu…Do` quedan una
sola vez arriba de todo.

- [ ] **Step 2: Escribir `FranjaDelTaller.tsx`**

Una línea por turno —`4-12`, `8-16`, `12-20`— con los nombres, y los que faltan
algún día marcados. Debajo, `sinTurno` si hay alguien, y «N días con gente
movida» si `diasConPisada > 0`. Con `porTurno: null`: «falta cargar la semana de
referencia del taller».

En el teléfono (343 px) va **una línea por turno, apiladas**: tres columnas
quedan en 114 px y ahí no entra un turno con sus nombres. O sea
`grid-cols-1 sm:grid-cols-3`.

- [ ] **Step 3: Traer el taller del mes en `MesDeOrdenes`**

Pide `/api/mantenimiento/taller-del-mes` para el mismo rango que el calendario,
sólo si `puedeAsignar`. Un fallo **no rompe el mes**: la grilla de OT se sigue
viendo y la franja dice que no se pudo traer el taller, con el error.

- [ ] **Step 4: Pasarle `puedeAsignar` desde `ProgramacionClient`**

`/programacion` ya es sólo de admin, así que va `true`. `/planificacion` le pasa
`false` y no cambia en nada.

- [ ] **Step 5: Comprobar**

Run: `npm run tipos`
Run: `node scripts/revisar-responsive.mjs`
Expected: ROMPE 0 · APRETADO 0 · MIRAR 1 (la tabla de Calidad que ya estaba).

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/mantenimiento/ordenes/FranjaDelTaller.tsx" "app/(app)/mantenimiento/ordenes/CalendarioDeOT.tsx" "app/(app)/mantenimiento/ordenes/MesDeOrdenes.tsx" "app/(app)/mantenimiento/programacion/ProgramacionClient.tsx"
git commit -m "feat(mantenimiento): el mes muestra la rotacion de cada semana"
```

---

### Task 6: Poner y sacar operarios de una OT

**Files:**
- Create: `app/(app)/mantenimiento/ordenes/AsignarOperariosModal.tsx`
- Modify: `app/(app)/mantenimiento/ordenes/CalendarioDeOT.tsx`
- Modify: `app/(app)/mantenimiento/ordenes/MesDeOrdenes.tsx`
- Modify: `lib/mantenimiento/calendarioDeOT.ts`
- Modify: `app/api/mantenimiento/calendario/route.ts`
- Modify: `lib/mantenimiento/calendarioDeOT.test.ts`

**Interfaces:**
- Consumes: las Tareas 2, 3 y 4; `Modal`/`PieDeModal` de `components/Modal.tsx`;
  `Select` de `components/Select.tsx`.
- Produces: `DiaDelCalendario["ordenes"][number]` gana `operario_1`,
  `operario_2`, `operario_3` (`string | null`), que la grilla necesita para
  decir qué posiciones están ocupadas sin otro viaje. **No son dato sensible**:
  quien llega ahí ya ve las órdenes enteras en el listado, y son los mismos
  nombres que la planilla publica.

- [ ] **Step 1: Hacer viajar los tres campos**

Agregarlos a `OrdenDelCalendario` y a `DiaDelCalendario["ordenes"][number]` en
`lib/mantenimiento/calendarioDeOT.ts`, copiarlos en `armarElCalendario`, y
sumarlos al `select()` literal de `app/api/mantenimiento/calendario/route.ts`.

- [ ] **Step 2: Extender el test de los campos que la grilla necesita**

En `lib/mantenimiento/calendarioDeOT.test.ts`, el `it("copia los campos que la
grilla necesita")` tiene que esperar también los tres operarios.

Run: `npx vitest run lib/mantenimiento/calendarioDeOT.test.ts`
Expected: PASS

- [ ] **Step 3: Escribir `AsignarOperariosModal.tsx`**

Un `<Modal titulo={`Asignar la OT #${orden.ot_number}`}>` con las tres
posiciones. Cada una: quién está puesto —con un botón de sacar— o un `<Select>`
con los nombres del catálogo de esa posición. Al lado de cada nombre, lo que la
Tarea 4 sabe de ese día: su turno, «falta» o «de franco», o el motivo por el que
no se sabe. **No el tipo de la ausencia.**

Lo que no entra no se esconde: se ofrece deshabilitado con el motivo que da
`porQueNoEntra`.

**El oficio que la OT pide sale de su especialidad**, con
`oficioDeLaEspecialidad()` de `lib/mantenimiento/genteDelDia.ts`, que ya existe:
MECANICO → mecánico, ELECTRICO → electricista, LUBRICACION → lubricador. Los
del oficio que toca van primero y se dice por qué. Con `null` —CIVIL,
INSTRUMENTACIÓN y OTRO— **no se sugiere a nadie** y el orden es el del catálogo:
inventarles un oficio sería enlazar al que se le parece.

Guarda con un `PATCH` a `/api/mantenimiento/ordenes` con el cuerpo de
`elCuerpoDeLaAsignacion`. Si la respuesta trae `planilla_error`, se muestra **lo
que dijo Google, sin traducir**; y si la acción era sacar, se agrega que hay que
sacarlo también en la planilla porque la sincronización lo va a devolver.

Lleva `useBorrador` sólo si termina teniendo un campo de texto libre; con tres
desplegables no hay nada escrito que perder y entonces va `soloLectura`.

- [ ] **Step 4: Colgarlo del panel del día**

En el panel del día de `CalendarioDeOT`, cada orden gana un botón «Asignar» —o
el motivo de `porQueNoSePuedeAsignar`— cuando el modo es `programar` y la
pantalla pasó `puedeAsignar`. `MesDeOrdenes` abre el modal y, al guardar, suma
uno a `recarga` para volver a pedir el mes.

- [ ] **Step 5: Comprobar**

Run: `npm test`
Run: `npm run tipos`
Run: `NODE_OPTIONS=--max-old-space-size=8192 npm run build`
Run: `node scripts/revisar-responsive.mjs`
Run: `node scripts/revisar-modales.mjs` → ROMPE 0 · MIRAR 0
Run: `node scripts/revisar-exportaciones.mjs` → ROMPE 0

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/mantenimiento/ordenes/AsignarOperariosModal.tsx" "app/(app)/mantenimiento/ordenes/CalendarioDeOT.tsx" "app/(app)/mantenimiento/ordenes/MesDeOrdenes.tsx" lib/mantenimiento/calendarioDeOT.ts lib/mantenimiento/calendarioDeOT.test.ts app/api/mantenimiento/calendario/route.ts
git commit -m "feat(mantenimiento): asignar operarios a una OT desde el mes"
```

---

### Task 7: Dejarlo escrito

**Files:**
- Modify: `docs/MANTENIMIENTO-INTEGRACION.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: La sección del documento del módulo**

En `docs/MANTENIMIENTO-INTEGRACION.md`, dentro de
`## La programación semanal del taller`, una subsección
`### Asignar operarios desde el mes` con lo que no se deduce del código: el
catálogo con posiciones y el 1.223 de 1.223; que 7 de 10 nombres resuelven y los
otros tres se cierran con datos; que los nombres no viajan por la ruta del
calendario y por qué; que la franja es el ciclo y el día es la verdad; y que
sacar sólo pega si la planilla se dejó escribir.

- [ ] **Step 2: El renglón de `CLAUDE.md`**

En la fila «Mantenimiento — programación del taller», sumar la pestaña y el
enlace al spec y a este plan, con las dos mediciones que evitan rehacer el
análisis: el conteo constante y el 1.223 de 1.223.

- [ ] **Step 3: Commit**

```bash
git add docs/MANTENIMIENTO-INTEGRACION.md CLAUDE.md
git commit -m "docs(mantenimiento): asignar operarios desde el mes"
```
