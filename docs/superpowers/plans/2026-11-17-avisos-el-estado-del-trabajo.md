# El estado del trabajo en el aviso — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que las dos listas de avisos digan si el trabajo que salió del aviso
terminó o sigue abierto, y no sólo que existe una OT.

**Architecture:** Se resuelve `avisos.work_order_id` de verdad —un relleno de
una vez y después la sincronización en cada corrida— y recién entonces las
pantallas muestran el estado de la orden. La regla de qué mostrar vive en una
función pura nueva; `/mantenimiento/avisos` lee la orden embebida con la
sesión y `/mis-avisos`, que está abierta a los catorce usuarios, la lee por una
ruta con cliente admin porque `ordenes_trabajo` tiene el SELECT cerrado.

**Tech Stack:** Next.js 16 App Router, Supabase (PostgREST), TypeScript,
Vitest, Tailwind v4.

**Spec:** [docs/superpowers/specs/2026-11-16-avisos-el-estado-del-trabajo-design.md](../specs/2026-11-16-avisos-el-estado-del-trabajo-design.md)

## Global Constraints

- **Todo en castellano**: nombres, comentarios, textos de pantalla y mensajes
  de commit. Conventional commits (`feat(mantenimiento): …`).
- **No se toca `finalDelAviso()`** ni `lib/mantenimiento/desestimarAviso.ts`.
  De ahí cuelgan el filtro «Sin OT» y los conteos de las dos pantallas.
- **Un `select()` va literal**, nunca armado en una variable: si no, se pierde
  la inferencia de tipos de Supabase.
- **`traerTodo()` de `lib/core/paginado.ts`** en cualquier lectura que pueda
  pasar de 1000 filas. `ordenes_trabajo` tiene 2.489.
- **Un `.in()` va de a lotes de 200 ids** como mucho.
- **Las migraciones las aplica una persona** en el editor SQL de Supabase. Un
  agente escribe el archivo y espera; DML sí puede aplicar por PostgREST.
- **No se escribe ninguna planilla.** `work_order_id` y `ot_resuelta_en` son
  del sistema; la columna `OT ASIGNADA` sigue siendo la que escribe una persona.
- **Nunca `git add -A`**: hay otras sesiones en este árbol. Se commitea
  nombrando los archivos.
- **El árbol de trabajo está en la rama `sincronizaciones-despliegue-canonico`,
  que es de otra sesión.** Cada commit de este plan va a `main` con plumbing
  —`GIT_INDEX_FILE` aparte, `read-tree origin/main`, `commit-tree`,
  `update-ref refs/heads/main`— y se pushea con `git push origin main:main`.
  Nunca `git checkout main` ni `git add` sobre el índice compartido.
- **Los estados de una OT son cuatro**: `REALIZADO`, `ATRASADO`, `POR_HACER`,
  `EN_PROCESO`. Cerrada es `estado === "REALIZADO"`, **nunca** «tiene fecha».

Medido contra producción el 17/11/2026, y son los números que las tareas
esperan:

| | |
|---|---|
| avisos en total | 238 |
| con `work_order_id` | 39 — **17** enlazados a mano (`ot_enlazada_en`) y **22** con la OT generada desde el aviso |
| con el número sólo como texto en `ot_asignada` | 182, y los 182 resuelven a una OT existente |
| texto que no es un número | 10 |
| sin nada | 7 |
| de los 221 resolubles, con la OT abierta | **13** (el resto, 208, cerradas) |
| OT abiertas en todo el sistema | 55 |
| `ot_number` repetidos | 0 de 2.489 |
| OT en `REALIZADO` sin `fecha_cierre` | 220 |

## Review Focus

Cinco cosas que el diseño implica y que ninguna tarea probaría sola. Cada una
tiene su test en la tarea que la posee.

1. **Una OT que el sistema generó desde el aviso no la toca la
   sincronización.** Son 22 y tienen `ot_enlazada_en` en null igual que los
   182: sin el `ot_resuelta_en` de la tarea 1, vaciar la celda de la planilla
   dejaría una orden huérfana. → test en la tarea 2.
2. **Un enlace hecho a mano no se pisa nunca**, aunque el texto de
   `ot_asignada` diga otro número. → test en la tarea 2.
3. **Una OT cerrada sin `fecha_cierre` se muestra «Cerrada», no «abierta».**
   Son 220 de 2.489, cerca de una de cada diez. → test en la tarea 3.
4. **Un texto que no es un número no se interpreta**: `Revision`, `-`,
   `1889 - 1886` se muestran crudos y no resuelven ninguna OT. → tests en las
   tareas 2 y 3.
5. **`/mis-avisos` no puede quedarse sin decir nada si la ruta falla.** La
   pantalla la abren catorce personas y seis no tienen el módulo: un fallo de
   la ruta tiene que dejar el aviso diciendo lo de hoy —«OT #2814»— y no
   «sin orden». → test en la tarea 3 (`estadoDelTrabajo` con `ot` en
   `undefined`) y comportamiento en la tarea 5.

---

## Task 1: La migración

Apaga la cascada y agrega la columna que distingue el enlace automático. **Es
DDL: la aplica el usuario.** Nada de lo que sigue funciona del todo hasta que
corra, pero las tareas 2 a 6 se pueden escribir y testear igual.

**Files:**
- Create: `supabase/migrations/<marca>_el_aviso_sobrevive_a_su_orden.sql`
  (el nombre lo genera el comando del paso 1)

**Interfaces:**
- Produces: la columna `avisos.ot_resuelta_en timestamptz` (null por defecto),
  y `avisos_work_order_id_fkey` con `on delete set null`. Las tareas 2, 4, 5 y
  6 leen y escriben esa columna.

- [ ] **Step 1: Crear el archivo**

```bash
npm run migracion "el aviso sobrevive a su orden"
```

- [ ] **Step 2: Escribir la migración**

Encabezado largo en castellano, con estas dos razones medidas:

- La cascada se decidió el 18/10/2026 (`20261018160209`) cuando sólo **39**
  avisos tenían enlace. Rellenar los 182 sube la superficie a **221**, y la
  sincronización borra OT que la planilla deja de traer en cada corrida. El
  aviso es el reporte de una persona, no un detalle de la orden: si la orden se
  va, el aviso sobrevive y vuelve a decir «sin orden».
- `ot_resuelta_en` existe porque `ot_enlazada_en is null` no separa en dos sino
  en tres: 17 enlaces manuales, **22 OT generadas desde el aviso** y 182 por
  resolver. La escribe **sólo** la resolución automática —el relleno y la
  sincronización—, igual que `ot_enlazada_en` la escribe sólo la ruta de
  enlazar, y sin ella vaciar la celda de la planilla orfanaría una de esas 22.

El cuerpo son tres sentencias:

```sql
alter table public.avisos
  drop constraint if exists avisos_work_order_id_fkey;

alter table public.avisos
  add constraint avisos_work_order_id_fkey
  foreign key (work_order_id) references public.ordenes_trabajo(id) on delete set null;

alter table public.avisos
  add column if not exists ot_resuelta_en timestamptz;

comment on column public.avisos.ot_resuelta_en is
  'Cuándo la resolvió el sistema desde el número tipeado en OT ASIGNADA. Null es que el enlace no es automático: lo hizo «Ya tiene OT» (ot_enlazada_en) o la OT nació de este aviso.';
```

- [ ] **Step 3: Commitear y pedirle al usuario que la aplique**

```bash
git add supabase/migrations/<archivo>.sql
git commit -m "feat(mantenimiento): el aviso sobrevive a su orden y el enlace automatico se distingue"
```

(con el plumbing a `main` que dicen las Global Constraints). Decirle al usuario
que hay una migración para correr y **esperar su confirmación** antes de la
tarea 4.

---

## Task 2: La regla de qué enlace recalcular

Función pura, sin base. Decide qué avisos hay que tocar y cómo, a partir de lo
que ya está en la tabla.

**Files:**
- Create: `lib/mantenimiento/enlaceDelAviso.ts`
- Test: `lib/mantenimiento/enlaceDelAviso.test.ts`

**Interfaces:**
- Produces:

```ts
export interface AvisoAResolver {
  id: string;
  ot_asignada: string | null;
  work_order_id: string | null;
  ot_enlazada_en?: string | null;
  ot_resuelta_en?: string | null;
}

/** El número que la planilla escribió, o null si eso no es un número. */
export function numeroDeOtDelTexto(texto: string | null | undefined): number | null;

export interface LoQueHayQueReenlazar {
  /** Un grupo por OT: a esos avisos se les escribe ese `work_order_id`. */
  aEnlazar: { otId: string; avisoIds: string[] }[];
  /** Avisos a los que hay que vaciarles el enlace automático. */
  aVaciar: string[];
}

export function loQueHayQueReenlazar(
  avisos: readonly AvisoAResolver[],
  idPorNumero: ReadonlyMap<number, string>
): LoQueHayQueReenlazar;
```

Las tareas 4 y 6 la consumen.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
describe("numeroDeOtDelTexto", () => {
  it("devuelve el número cuando el texto son sólo dígitos", () => {
    expect(numeroDeOtDelTexto(" 2814 ")).toBe(2814);
  });
  it("devuelve null para lo que no es un número", () => {
    for (const t of ["Revision", "-", "si", "1889 - 1886", "RI 1888", "", null, undefined]) {
      expect(numeroDeOtDelTexto(t)).toBeNull();
    }
  });
});

describe("loQueHayQueReenlazar", () => {
  const mapa = new Map([[2814, "ot-a"], [2815, "ot-b"]]);

  it("completa el aviso que tiene el número y no tiene enlace", () => {
    const r = loQueHayQueReenlazar([{ id: "a1", ot_asignada: "2814", work_order_id: null }], mapa);
    expect(r.aEnlazar).toEqual([{ otId: "ot-a", avisoIds: ["a1"] }]);
    expect(r.aVaciar).toEqual([]);
  });

  it("junta en un solo grupo los avisos que apuntan a la misma OT", () => {
    const r = loQueHayQueReenlazar([
      { id: "a1", ot_asignada: "2814", work_order_id: null },
      { id: "a2", ot_asignada: "2814", work_order_id: null },
    ], mapa);
    expect(r.aEnlazar).toEqual([{ otId: "ot-a", avisoIds: ["a1", "a2"] }]);
  });

  it("NO toca un enlace que hizo una persona, aunque el número cambie", () => {
    const r = loQueHayQueReenlazar([{
      id: "a1", ot_asignada: "2815", work_order_id: "ot-a",
      ot_enlazada_en: "2026-10-26T10:00:00Z",
    }], mapa);
    expect(r).toEqual({ aEnlazar: [], aVaciar: [] });
  });

  it("NO toca la OT que nació de este aviso: los dos sellos en null y ya enlazado", () => {
    const r = loQueHayQueReenlazar([{
      id: "a1", ot_asignada: "", work_order_id: "ot-a",
      ot_enlazada_en: null, ot_resuelta_en: null,
    }], mapa);
    expect(r).toEqual({ aEnlazar: [], aVaciar: [] });
  });

  it("corrige el número que alguien arregló en la planilla", () => {
    const r = loQueHayQueReenlazar([{
      id: "a1", ot_asignada: "2814", work_order_id: "ot-b",
      ot_resuelta_en: "2026-11-17T10:00:00Z",
    }], mapa);
    expect(r.aEnlazar).toEqual([{ otId: "ot-a", avisoIds: ["a1"] }]);
  });

  it("vacía el enlace automático cuando la celda quedó vacía", () => {
    const r = loQueHayQueReenlazar([{
      id: "a1", ot_asignada: "", work_order_id: "ot-a",
      ot_resuelta_en: "2026-11-17T10:00:00Z",
    }], mapa);
    expect(r).toEqual({ aEnlazar: [], aVaciar: ["a1"] });
  });

  it("vacía también cuando el texto dejó de ser un número", () => {
    const r = loQueHayQueReenlazar([{
      id: "a1", ot_asignada: "Revision", work_order_id: "ot-a",
      ot_resuelta_en: "2026-11-17T10:00:00Z",
    }], mapa);
    expect(r.aVaciar).toEqual(["a1"]);
  });

  it("no escribe nada cuando el enlace ya es el que corresponde", () => {
    const r = loQueHayQueReenlazar([{
      id: "a1", ot_asignada: "2814", work_order_id: "ot-a",
      ot_resuelta_en: "2026-11-17T10:00:00Z",
    }], mapa);
    expect(r).toEqual({ aEnlazar: [], aVaciar: [] });
  });

  it("deja en paz al aviso cuyo número el sistema no conoce", () => {
    const r = loQueHayQueReenlazar([{ id: "a1", ot_asignada: "9999", work_order_id: null }], mapa);
    expect(r).toEqual({ aEnlazar: [], aVaciar: [] });
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run lib/mantenimiento/enlaceDelAviso.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Escribir `lib/mantenimiento/enlaceDelAviso.ts`**

Con encabezado largo que explique los tres grupos y por qué el `aVaciar` no
alcanza a los 22 (ver la correción 4 del diseño). La regla, en una frase: un
aviso entra al recálculo sólo si `ot_enlazada_en` está en null **y** o bien no
tiene `work_order_id`, o bien tiene `ot_resuelta_en`. Un número que el mapa no
conoce no produce ni enlace ni vaciado — enlazar al que se le parece es peor
que dejar en null, y vaciar un enlace bueno por una sincronización a medias
sería peor todavía.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run lib/mantenimiento/enlaceDelAviso.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/mantenimiento/enlaceDelAviso.ts lib/mantenimiento/enlaceDelAviso.test.ts
git commit -m "feat(mantenimiento): la regla de que enlace de aviso se recalcula"
```

---

## Task 3: La regla de qué mostrar

La otra función pura: qué dice la pantalla sobre un aviso, dada su orden.

**Files:**
- Create: `lib/mantenimiento/trabajoDelAviso.ts`
- Test: `lib/mantenimiento/trabajoDelAviso.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:

```ts
export interface OtDelAviso {
  ot_number: number | null;
  estado: string | null;
  fecha_cierre: string | null;
}

export type EstadoDelTrabajo =
  | { tipo: "cerrado"; ot: number; fecha: string | null }
  | { tipo: "abierto"; ot: number; estado: string; comoSeLlama: string }
  | { tipo: "sin-enlace"; texto: string }
  | { tipo: "sin-ot" };

export function estadoDelTrabajo(
  aviso: { work_order_id?: string | null; ot_asignada?: string | null; desestimado_en?: string | null },
  ot: OtDelAviso | null | undefined
): EstadoDelTrabajo;
```

`comoSeLlama` es el estado en castellano para la pantalla: `POR_HACER` → «Por
hacer», `EN_PROCESO` → «En proceso», `ATRASADO` → «Atrasada», y cualquier otro
valor se muestra tal cual vino. Las tareas 5 y 6 la consumen.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
describe("estadoDelTrabajo", () => {
  const conOt = { work_order_id: "ot-a", ot_asignada: "2814" };

  it("cerrado con fecha", () => {
    expect(estadoDelTrabajo(conOt, { ot_number: 2814, estado: "REALIZADO", fecha_cierre: "2026-11-04" }))
      .toEqual({ tipo: "cerrado", ot: 2814, fecha: "2026-11-04" });
  });

  it("cerrado sin fecha: lo decide el estado y no la fecha (son 220 OT)", () => {
    expect(estadoDelTrabajo(conOt, { ot_number: 2814, estado: "REALIZADO", fecha_cierre: null }))
      .toEqual({ tipo: "cerrado", ot: 2814, fecha: null });
  });

  it.each([
    ["POR_HACER", "Por hacer"],
    ["EN_PROCESO", "En proceso"],
    ["ATRASADO", "Atrasada"],
  ])("abierto: %s", (estado, comoSeLlama) => {
    expect(estadoDelTrabajo(conOt, { ot_number: 2814, estado, fecha_cierre: null }))
      .toEqual({ tipo: "abierto", ot: 2814, estado, comoSeLlama });
  });

  it("un estado que no conocemos se muestra tal cual", () => {
    const r = estadoDelTrabajo(conOt, { ot_number: 2814, estado: "ANULADO", fecha_cierre: null });
    expect(r).toEqual({ tipo: "abierto", ot: 2814, estado: "ANULADO", comoSeLlama: "ANULADO" });
  });

  it("sin enlace: el texto crudo de la planilla", () => {
    expect(estadoDelTrabajo({ work_order_id: null, ot_asignada: "1889 - 1886" }, null))
      .toEqual({ tipo: "sin-enlace", texto: "1889 - 1886" });
    expect(estadoDelTrabajo({ work_order_id: null, ot_asignada: "Revision" }, null))
      .toEqual({ tipo: "sin-enlace", texto: "Revision" });
  });

  it("sin orden: pendiente o desestimado", () => {
    expect(estadoDelTrabajo({ work_order_id: null, ot_asignada: null }, null)).toEqual({ tipo: "sin-ot" });
    expect(estadoDelTrabajo({ work_order_id: null, ot_asignada: "", desestimado_en: "2026-10-21" }, null))
      .toEqual({ tipo: "sin-ot" });
  });

  it("si la orden no llegó, el aviso sigue diciendo lo de siempre y nunca «sin orden»", () => {
    expect(estadoDelTrabajo(conOt, undefined)).toEqual({ tipo: "sin-enlace", texto: "2814" });
  });

  it("el guión suelto de la planilla no es una orden", () => {
    expect(estadoDelTrabajo({ work_order_id: null, ot_asignada: "-" }, null))
      .toEqual({ tipo: "sin-enlace", texto: "-" });
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run lib/mantenimiento/trabajoDelAviso.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Escribir `lib/mantenimiento/trabajoDelAviso.ts`**

Encabezado largo: por qué es un archivo nuevo y no una rama más de
`finalDelAviso()` —ésa contesta «¿se decidió qué hacer?» y de ella cuelgan los
filtros que hoy andan— y por qué «cerrada» lo decide `estado` y jamás la
presencia de `fecha_cierre`.

El caso de `ot` en `undefined` es el importante y va comentado: quiere decir
«no se pudo leer la orden», no «no hay orden», y por eso cae en `sin-enlace`
con el texto que ya se mostraba.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run lib/mantenimiento/trabajoDelAviso.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/mantenimiento/trabajoDelAviso.ts lib/mantenimiento/trabajoDelAviso.test.ts
git commit -m "feat(mantenimiento): la regla de que dice un aviso sobre su orden de trabajo"
```

---

## Task 4: El relleno de una vez

Script `.mts` con corrida en seco, como `scripts/rellenar-area-de-avisos.mts`.
**Necesita la migración de la tarea 1 aplicada** (escribe `ot_resuelta_en`).

**Files:**
- Create: `scripts/rellenar-el-enlace-de-avisos.mts`

**Interfaces:**
- Consumes: `loQueHayQueReenlazar` y `numeroDeOtDelTexto` de la tarea 2,
  `traerTodo` de `lib/core/paginado.ts`, `createAdminClient`.

- [ ] **Step 1: Escribir el script**

Copia la forma de `scripts/rellenar-area-de-avisos.mts`: carga `.env.local` a
mano, imports dinámicos con extensión `.ts`, `--aplicar` por `process.argv`,
lotes de 200.

Qué hace:

1. `traerTodo` de `avisos` con
   `select("id, oa_number, ot_asignada, work_order_id, ot_enlazada_en, ot_resuelta_en")`.
2. `traerTodo` de `ordenes_trabajo` con `select("id, ot_number")`, y armar el
   `Map<number, string>`.
3. Llamar a `loQueHayQueReenlazar`. **El relleno sólo aplica `aEnlazar`**, e
   ignora `aVaciar`: corre una sola vez sobre una base donde nadie resolvió
   nada todavía, así que un vaciado ahí sólo podría venir de un error de
   lectura. Eso va comentado.
4. En seco: imprimir cuántos avisos quedarían con enlace, cuántos se dejan sin
   tocar y el desglose de por qué —ya enlazado a mano, OT nacida del aviso,
   texto que no es número, número que el sistema no conoce, sin nada—.
5. Con `--aplicar`: por cada grupo,
   `update({ work_order_id: otId, ot_resuelta_en: cuando })` con
   `.in("id", lote)` **más `.is("work_order_id", null).is("ot_enlazada_en", null)`
   repetidos en el `where`** — si alguien enlazó entre la lectura y la
   escritura, no se lo pisa. `cuando` es un solo `toISOString()` para toda la
   corrida.
6. Imprimir cuántos se actualizaron de cuántos, y decir que la diferencia son
   avisos que recibieron enlace entre la lectura y la escritura.

- [ ] **Step 2: Correrlo en seco**

Run: `npx tsx scripts/rellenar-el-enlace-de-avisos.mts`
Expected: dice que **182** quedarían con enlace, 0 fallos de resolución, y
deja sin tocar 17 enlazados a mano, 22 con la OT nacida del aviso, 10 de texto
que no es número y 7 sin nada.

Si los números no son ésos, **parar y decírselo al usuario**: el diseño se
construyó sobre esa medición.

- [ ] **Step 3: Aplicarlo**

Run: `npx tsx scripts/rellenar-el-enlace-de-avisos.mts --aplicar`
Expected: `Actualizados: 182 de 182.`

- [ ] **Step 4: Comprobar contra la base**

Correr de nuevo en seco: tiene que decir **0 por enlazar**, y los avisos con
`work_order_id` pasan de 39 a **221**.

- [ ] **Step 5: Commit**

```bash
git add scripts/rellenar-el-enlace-de-avisos.mts
git commit -m "feat(mantenimiento): rellenar el enlace de los 182 avisos que solo tenian el numero"
```

---

## Task 5: La sincronización lo mantiene

Sin esto la pantalla se congela sola: hoy casi todos los avisos entran por el
Forms.

**Files:**
- Modify: `lib/mantenimiento/sincronizar.ts` (`sincronizarAvisos`, línea 326 y
  siguientes)
- Create: `lib/mantenimiento/resolverElEnlace.ts`
- Test: `lib/mantenimiento/resolverElEnlace.test.ts`

**Interfaces:**
- Consumes: `loQueHayQueReenlazar`, `numeroDeOtDelTexto` (tarea 2).
- Produces:

```ts
/** Lo que se escribió, o el motivo por el que no se pudo. */
export interface EnlacesResueltos {
  enlazados: number;
  vaciados: number;
  error?: string;
}

export async function resolverLosEnlacesDeAvisos(
  admin: ReturnType<typeof createAdminClient>
): Promise<EnlacesResueltos>;
```

- [ ] **Step 1: Escribir el test que falla**

La función toca la base, así que lo que se testea es el reparto de escrituras
con un doble del cliente que registra las llamadas. Un solo test, el que
prueba la decisión que no se deduce:

```ts
it("escribe un update por OT y uno solo para los vaciados, con los dos guardas en el where", async () => {
  // doble que devuelve dos avisos a enlazar a la misma OT y uno a vaciar,
  // y registra cada update con su payload y sus filtros
  const r = await resolverLosEnlacesDeAvisos(doble as never);
  expect(r).toEqual({ enlazados: 2, vaciados: 1 });
  expect(doble.updates).toHaveLength(2);
  expect(doble.updates[0].payload.ot_resuelta_en).toBeTruthy();
  expect(doble.updates[0].filtros).toContain("ot_enlazada_en is null");
  expect(doble.updates[1].payload).toEqual({ work_order_id: null, ot_resuelta_en: null });
});
```

Si armar el doble se vuelve más largo que la función, **dejar sólo los tests
de la tarea 2 y decirlo** en el commit: la decisión ya está probada ahí y un
doble que imita a PostgREST prueba el doble, no el código.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run lib/mantenimiento/resolverElEnlace.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Escribir `lib/mantenimiento/resolverElEnlace.ts`**

1. Leer los avisos candidatos con `traerTodo`:
   `select("id, ot_asignada, work_order_id, ot_enlazada_en, ot_resuelta_en")`
   filtrando `.is("ot_enlazada_en", null)`.
2. Juntar los números de `ot_asignada` con `numeroDeOtDelTexto` y traer esas
   OT con `.in("ot_number", lote)` **de a 200**. Nunca las 2.489 enteras.
3. `loQueHayQueReenlazar`, y escribir:
   - por grupo de `aEnlazar`:
     `update({ work_order_id, ot_resuelta_en: cuando })`, `.in("id", lote)`,
     `.is("ot_enlazada_en", null)` y `.or("work_order_id.is.null,ot_resuelta_en.not.is.null")`.
   - `aVaciar`, en lotes de 200:
     `update({ work_order_id: null, ot_resuelta_en: null })`, `.in("id", lote)`,
     `.is("ot_enlazada_en", null)`, `.not("ot_resuelta_en", "is", null)`.
4. Cualquier error vuelve en `error` y **no se tira**: la corrida tiene que
   seguir.

Encabezado largo con la decisión que no se deduce, copiada del diseño: va como
un `UPDATE` aparte y no dentro del upsert porque **supabase-js arma `columns`
con la unión de las claves de todo el lote** y le manda `null` a la fila que no
la trae — meterlo adentro obligaría a partir las filas en cuatro grupos. Y el
otro motivo, el que importa más: lee `ot_asignada` **de la tabla y no de la
fila de la planilla**, así que respeta sola a los avisos que el upsert salteó
por tener la exportación pendiente.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run lib/mantenimiento/resolverElEnlace.test.ts`
Expected: PASS

- [ ] **Step 5: Engancharlo en `sincronizarAvisos`**

Después del upsert y del `borrarLoQueLaPlanillaNoTrajo`, antes de
`registrarSincronizacion`. El resultado entra en el JSON de `logra({...})` como
`enlaces_resueltos` y `enlaces_vaciados`, y el motivo —cuando lo hay— como
`enlace_sin_resolver`, al lado de `area_sin_leer` y con el mismo criterio: sólo
cuando lo hay, para que no sea un campo que está siempre en null y se deja de
mirar.

Un fallo acá **no cambia el `ok` de `registrarSincronizacion`**, a diferencia
de las áreas: el área decide en qué pantalla aparece un aviso y un fallo
sostenido lo esconde, mientras que el enlace se recalcula entero en la próxima
corrida y lo único que se pierde mientras tanto es decir si el trabajo terminó.
Eso va comentado, porque es una asimetría que invita a «unificarla».

- [ ] **Step 6: Verificar**

Run: `npx tsc --noEmit && npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/mantenimiento/resolverElEnlace.ts lib/mantenimiento/resolverElEnlace.test.ts lib/mantenimiento/sincronizar.ts
git commit -m "feat(mantenimiento): la sincronizacion resuelve el enlace del aviso a su OT"
```

---

## Task 6: `/mantenimiento/avisos` muestra el estado

La pantalla de adentro del módulo: lee con la sesión y puede embeber, porque
ahí sólo entra quien tiene Mantenimiento.

**Files:**
- Modify: `app/(app)/mantenimiento/avisos/page.tsx:21-26` (el `select()`)
- Modify: `app/(app)/mantenimiento/avisos/AvisosClient.tsx` (el componente
  `ConOt`, alrededor de la línea 520)
- Modify: `lib/mantenimiento/types.ts` (el tipo `Aviso`, si el embebido no entra solo)

**Interfaces:**
- Consumes: `estadoDelTrabajo` y `OtDelAviso` (tarea 3).

- [ ] **Step 1: Agregar el embebido**

En `page.tsx`, el `select()` pasa a ser **literal**:

```ts
.select("*, equipos(name, code), sectores(nombre), ordenes_trabajo(ot_number, estado, fecha_cierre)")
```

- [ ] **Step 2: Pintar el estado en `ConOt`**

`ConOt` deja de armar el texto a mano y llama a `estadoDelTrabajo(aviso,
aviso.ordenes_trabajo)`. Lo que muestra:

```
OT #2814 · En proceso
OT #2790 · Cerrada el 4/11
OT #2915 · Cerrada
la planilla dice «1889 - 1886»
```

La fecha va en d/m, con la misma forma que `enDiaMes` de
`desestimarAviso.ts` —no importarla: es privada; escribir el formateo donde se
use o exportarla—. **El color de estado va por `style` y no por una utilidad
de Tailwind**: `.card` y los `.btn-*` están declarados fuera de toda capa y le
ganan a `text-*`. El «desenlazar» sigue exactamente como está, con
`sePuedeDesenlazar`.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && node scripts/revisar-responsive.mjs`
Expected: tsc limpio; responsive **ROMPE 0 · APRETADO 0 · MIRAR 0**.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/mantenimiento/avisos/page.tsx" "app/(app)/mantenimiento/avisos/AvisosClient.tsx" lib/mantenimiento/types.ts
git commit -m "feat(mantenimiento): la lista de avisos dice en que estado esta la OT"
```

---

## Task 7: La ruta que le dice el estado a `/mis-avisos`

**Files:**
- Create: `app/api/mantenimiento/avisos/trabajo/route.ts`

**Interfaces:**
- Produces: `GET /api/mantenimiento/avisos/trabajo` →
  `{ ordenes: { id: string; ot_number: number; estado: string | null; fecha_cierre: string | null }[] }`,
  una entrada por **cada OT enlazada a algún aviso** (221 hoy). La tarea 8 la
  consume.

- [ ] **Step 1: Escribir la ruta**

```ts
export async function GET(): Promise<NextResponse>
```

1. Sesión con `createClient()`; sin usuario, 401. **No hace falta más
   permiso**: `avisos` tiene el SELECT abierto a cualquier autenticado desde
   `20261022101507` y acá se devuelve menos de lo que un aviso ya dice.
2. Con `createAdminClient()`: `traerTodo` de `avisos`
   `select("work_order_id").not("work_order_id", "is", null)`, juntar los ids
   únicos, y traer esas OT con `.in("id", lote)` de a 200,
   `select("id, ot_number, estado, fecha_cierre")`.
3. Un error de lectura devuelve 503 con el motivo —no 500—: la pantalla lo
   reintenta y un fallo acá es transitorio.

Encabezado largo con las tres cosas que no se deducen:

- **Por qué existe en vez de un embebido.** `ordenes_trabajo` tiene el SELECT
  cerrado con `mant_puede_ver()` desde `20260916110349`, y `/mis-avisos` la
  abren los catorce: a **6 de 14** el embebido les devolvería null **en
  silencio** y la pantalla diría «sin orden» sobre trabajo que existe. Es el
  mismo patrón que Disponibilidad con `ausencias`: lee con el cliente admin y
  **el permiso es el de la ruta**.
- **Por qué devuelve todas y no las de la página.** La pantalla pagina de a 50
  del lado del servidor, así que para filtrar «sólo los abiertos» necesita
  saber cuáles lo están antes de pedir la página. Son 221 filas de cuatro
  campos.
- **Qué se expone y qué no**: `ot_number`, `estado` y `fecha_cierre`, y nada
  más de la orden. La descripción, el equipo y el costo siguen dentro del
  módulo.

- [ ] **Step 2: Verificar que la ruta entra al mapa de APIs**

Run: `npm run mapa-de-apis && npx tsc --noEmit`
Expected: `docs/API-MAPA.generado.md` incluye la ruta nueva; tsc limpio.

- [ ] **Step 3: Commit**

```bash
git add "app/api/mantenimiento/avisos/trabajo/route.ts" docs/API-MAPA.generado.md
git commit -m "feat(mantenimiento): una ruta dice el estado de la OT a quien no tiene el modulo"
```

---

## Task 8: `/mis-avisos` muestra el estado y filtra los abiertos

**Files:**
- Modify: `app/(app)/mis-avisos/MisAvisosClient.tsx` (la carga, alrededor de
  la línea 99; la barra de filtros, alrededor de la 170; `EnQueTermino`,
  alrededor de la 396)

**Interfaces:**
- Consumes: la ruta de la tarea 7 y `estadoDelTrabajo` de la tarea 3.

- [ ] **Step 1: Traer el estado de las órdenes**

Un `useCargar` aparte del de los avisos, **sin dependencias**: se pide una vez
al montar y no en cada página ni en cada filtro. Guarda un
`Map<string, OtDelAviso>` por `id` de OT. Si falla, el mapa queda vacío y
`estadoDelTrabajo` recibe `undefined`: la pantalla sigue diciendo «OT #2814»,
que es lo de hoy, y nunca «sin orden».

- [ ] **Step 2: Pintar el estado en `EnQueTermino`**

Reemplaza la rama `con-ot` por lo que diga `estadoDelTrabajo(aviso,
mapa.get(aviso.work_order_id ?? ""))`. El link a `/mantenimiento/ordenes?q=`
sigue igual y sigue condicionado a `tieneMantenimiento`.

- [ ] **Step 3: El filtro de abiertos**

Un chip más al lado de «Mi área / Todos», con el texto «Sin cerrar». Cuando
está puesto, la consulta suma `.in("work_order_id", abiertas)`, donde
`abiertas` son los ids del mapa cuyo `estado` no es `REALIZADO` — **13 hoy**,
y en todo el sistema hay 55 OT abiertas, así que el `.in()` queda a dos
órdenes de magnitud de donde PostgREST empieza a rechazar la URL. Con la lista
vacía, el chip no consulta: dice que no hay ninguno sin cerrar.

El chip arranca apagado: la pantalla sigue abriendo como abre hoy.

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit && node scripts/revisar-responsive.mjs`
Expected: tsc limpio; responsive ROMPE 0.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/mis-avisos/MisAvisosClient.tsx"
git commit -m "feat(mantenimiento): mis avisos dice si el trabajo termino y deja ver solo lo abierto"
```

---

## Task 9: Los dos textos que dejaron de ser ciertos

Dos comentarios/mensajes que el relleno vuelve falsos. Ninguno cambia el
comportamiento; los dos mienten.

**Files:**
- Modify: `lib/mantenimiento/enlazarOtAlAviso.ts` (`loQueImpideDesenlazar`)
- Modify: `app/api/home/resumen/route.ts:156-158` (el comentario)
- Test: `lib/mantenimiento/enlazarOtAlAviso.test.ts`

**Interfaces:**
- Consumes: la columna `ot_resuelta_en` de la tarea 1.

- [ ] **Step 1: Escribir el test que falla**

`AvisoADesenlazar` suma `ot_resuelta_en?: string | null`.

```ts
it("al aviso que resolvió la sincronización le dice que el número está en la planilla", () => {
  const motivos = loQueImpideDesenlazar({
    oa_number: "A-120", work_order_id: "ot-a", ot_asignada: "2814",
    ot_enlazada_en: null, ot_resuelta_en: "2026-11-17T10:00:00Z",
  }, 2814);
  expect(motivos).toHaveLength(1);
  expect(motivos[0]).toContain("en la planilla");
  expect(motivos[0]).not.toContain("se generó desde el aviso");
});

it("al aviso cuya OT nació de él le sigue diciendo que hay que dar de baja la orden", () => {
  const motivos = loQueImpideDesenlazar({
    oa_number: "A-121", work_order_id: "ot-a", ot_asignada: "2814",
    ot_enlazada_en: null, ot_resuelta_en: null,
  }, 2814);
  expect(motivos[0]).toContain("darla de baja");
});

it("los dos siguen bloqueando el desenlazar", () => {
  for (const resuelta of [null, "2026-11-17T10:00:00Z"]) {
    expect(sePuedeDesenlazar({
      oa_number: "A-1", work_order_id: "ot-a", ot_asignada: "2814",
      ot_enlazada_en: null, ot_resuelta_en: resuelta,
    })).toBe(false);
  }
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run lib/mantenimiento/enlazarOtAlAviso.test.ts`
Expected: FAIL en el primero — hoy los dos casos dan el mismo texto.

- [ ] **Step 3: Partir el mensaje en dos**

Antes de la rama `if (!aviso.ot_enlazada_en)`, una rama nueva para
`ot_resuelta_en`: el número lo escribió alguien en la columna `OT ASIGNADA` y
la sincronización lo resolvió, así que borrarlo desde acá sería pisar lo que
alguien puso donde lee quien no entra al sistema — si está mal, se corrige en
la planilla. Es el mismo argumento del caso 1 del encabezado, y ahí hay que
decirlo: los 182 que ese encabezado cuenta como «sin `work_order_id`» ahora lo
tienen, y lo que los distingue es `ot_resuelta_en`.

- [ ] **Step 4: Arreglar el comentario de `resumen/route.ts`**

Dice «sólo los generados desde la app llenan `work_order_id`». Deja de ser
cierto: desde el 17/11/2026 lo llena también la sincronización, resolviendo el
número que alguien tipeó. **El conteo no cambia** —mira las dos columnas— y el
comentario tiene que decir por qué sigue mirando las dos: porque hay avisos con
texto que no es un número.

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run lib/mantenimiento/enlazarOtAlAviso.test.ts && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/mantenimiento/enlazarOtAlAviso.ts lib/mantenimiento/enlazarOtAlAviso.test.ts app/api/home/resumen/route.ts
git commit -m "fix(mantenimiento): los dos textos que el relleno del enlace volvio falsos"
```

---

## Task 10: La verificación entera y el documento del módulo

**Files:**
- Modify: `docs/MANTENIMIENTO-INTEGRACION.md` (sección nueva)
- Modify: `CLAUDE.md` (el renglón de Mantenimiento de la tabla)

- [ ] **Step 1: Correr las seis comprobaciones**

```bash
npm test
npx tsc --noEmit
npm run build
node scripts/revisar-arbol-commiteado.mjs
node scripts/revisar-responsive.mjs
node scripts/revisar-exportaciones.mjs
```

Expected: todo en verde. `revisar-exportaciones` tiene que seguir dando
**ROMPE 0 · MIRAR 0**: si marca algo, se tocó un camino de escritura a una
planilla sin querer. Parar el `npm run dev` antes del build.

- [ ] **Step 2: Escribir la sección del documento**

`## El estado del trabajo en un aviso` en
`docs/MANTENIMIENTO-INTEGRACION.md`, con las cuatro cosas que no se deducen del
código:

1. **`ot_enlazada_en is null` no separa en dos sino en tres.** 17 manuales, 22
   OT nacidas del aviso, 182 resueltas desde la planilla. `ot_resuelta_en` es
   lo que distingue a las últimas, y sin él vaciar una celda orfanaría una
   orden que el sistema creó.
2. **«Cerrada» lo decide `estado` y nunca la fecha.** 220 de 2.489 OT en
   `REALIZADO` no tienen `fecha_cierre`.
3. **`/mis-avisos` lee el estado de la OT por una ruta con cliente admin**, no
   embebido: `ordenes_trabajo` está cerrada con `mant_puede_ver()` y a 6 de 14
   el embebido les devolvería null en silencio. `/mantenimiento/avisos` sí
   embebe, porque ahí sólo entra quien tiene el módulo.
4. **Nada de esto se exporta.** La columna `OT ASIGNADA` sigue siendo la que
   escribe una persona y la que la sincronización lee; `work_order_id` y
   `ot_resuelta_en` son del sistema.

Y en `CLAUDE.md`, un renglón que apunte a esa sección, al spec y a este plan,
con la frase corta: un aviso no termina cuando nace la OT.

- [ ] **Step 3: Comprobar contra el dato**

Las dos que ningún test ve:

- 221 avisos de 238 con `work_order_id`, y los 17 restantes son los 10 de
  texto raro y los 7 sin nada.
- Después de la próxima sincronización, que un aviso nuevo del Forms con su
  número en `OT ASIGNADA` entre con `work_order_id` puesto y `ot_resuelta_en`
  sellado. Es la única prueba de que no se congeló.

- [ ] **Step 4: Commit y push**

```bash
git add docs/MANTENIMIENTO-INTEGRACION.md CLAUDE.md
git commit -m "docs(mantenimiento): por que un aviso no termina cuando nace la OT"
git push origin main:main
```
