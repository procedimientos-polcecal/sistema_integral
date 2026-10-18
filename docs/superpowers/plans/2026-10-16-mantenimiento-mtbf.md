# MTBF y confiabilidad en Mantenimiento — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Mantenimiento pueda ver, por equipo, cada cuánto falla (MTBF), la probabilidad de que aguante 7 y 30 días, y si el ritmo viene mejorando o empeorando.

**Architecture:** Toda la cuenta vive en una lib pura (`lib/mantenimiento/mtbf.ts`) que recibe filas y devuelve filas calculadas, con sus tests en vitest. Encima se montan tres consumidores que no calculan nada: la pantalla nueva `/mantenimiento/mtbf` (server component que lee con `traerTodo()`), la tarjeta en la ficha del equipo, y un recuadro en el tablero que pide los datos a una ruta API después del primer pintado. Ninguna escritura, ninguna migración.

**Tech Stack:** Next.js 16 (App Router), Supabase/PostgREST, TypeScript, vitest, recharts (vía `next/dynamic`), `components/Select.tsx`.

**Spec:** [docs/superpowers/specs/2026-10-16-mantenimiento-mtbf-design.md](../specs/2026-10-16-mantenimiento-mtbf-design.md)

## Global Constraints

- Castellano en todo: rutas, nombres de funciones y variables, comentarios, textos de pantalla y mensajes de commit.
- La fecha de una falla es **`fecha_ejecucion`, con `fecha` como respaldo** si viene vacía. Nunca `fecha` sola.
- Se excluyen las fallas con fecha posterior a hoy.
- Ventana: **365 días**. Denominador: **los días observados dentro de la ventana**, desde la primera falla registrada hasta hoy, inclusive.
- Plazos de confiabilidad: **7 y 30 días**, fijos.
- Aviso de ritmo cambiado: **≥ 6 fallas** en la ventana y factor **≥ 2** (o ≤ 0,5) contra los últimos **90 días**.
- Toda lectura de `ordenes_trabajo` va con `traerTodo()` de `lib/core/paginado.ts`: la tabla tiene 2.175 filas y PostgREST corta en 1000 sin avisar.
- Los `select()` de Supabase van como cadena literal en la llamada, nunca armados en una variable.
- Las fechas se comparan como texto `YYYY-MM-DD` o con partes locales, nunca con `toISOString()`.
- Todo desplegable de diez o más opciones usa `<Select>` de `components/Select.tsx`.
- `recharts` se carga con `next/dynamic` y `ssr: false`.

## Review Focus

Cinco entradas que el spec implica y que ninguna pantalla va a ejercitar sola. Cada una tiene su test en la tarea que la posee.

1. **Ninguna falla en la ventana** (base recién instalada, o filtro que deja cero): `diasObservados` divide por una lista vacía. Esperado: la pantalla dice que no hay datos, no un `NaN` ni un crash. → Tarea 1.
2. **Una sola falla, y es de hoy**: los días observados dan 1 y el MTBF da 1 día, que presentado como "falla todos los días" es falso. Esperado: con menos de dos semanas observadas el MTBF no se publica como número. → Tarea 1.
3. **Falla con `equipment_id` nulo**: no puede generar una fila con clave `null` ni sumarse a ningún equipo. Esperado: cae en la bolsa de no atribuidas. → Tarea 1.
4. **Meses sin ninguna falla en el medio de la serie**: la tendencia tiene que mostrar el cero, no saltearse el mes. Esperado: 12 puntos siempre. → Tarea 1.
5. **Equipo activo sin ninguna falla**: no tiene MTBF (división por cero). Esperado: "sin fallas · MTBF > N d", nunca el número de la ventana. → Tareas 1 y 3.

---

### Task 1: La cuenta

**Files:**
- Create: `lib/mantenimiento/mtbf.ts`
- Test: `lib/mantenimiento/mtbf.test.ts`

**Interfaces:**
- Consumes: `ultimosMeses(hoy: Date, cuantos: number): Mes[]` de `lib/mantenimiento/dashboard.ts`.
- Produces: todo lo que usan las tareas 2 a 5.

```ts
export const VENTANA_DIAS = 365;
export const PLAZOS = [7, 30] as const;
export const DIAS_RECIENTE = 90;
export const MIN_FALLAS_PARA_AVISO = 6;
export const FACTOR_AVISO = 2;
/** Bajo este piso de días observados, el MTBF no se publica. */
export const MINIMO_OBSERVADO = 14;

export interface OtCruda {
  ot_number: number;
  tipo: string | null;
  fecha: string | null;
  fecha_ejecucion: string | null;
  equipment_id: string | null;
  equipo_raw: string | null;
  especialidad: string | null;
}

export interface Falla {
  otNumber: number;
  equipmentId: string | null;
  equipoRaw: string | null;
  fecha: string;
  especialidad: string | null;
}

export interface RitmoCambiado {
  /** null cuando no falló en los últimos 90 días. */
  mtbfReciente: number | null;
  /** null cuando `mtbfReciente` es null: la mejora no tiene factor. */
  factor: number | null;
  direccion: "mejoro" | "empeoro";
}

export interface FilaMtbf {
  equipmentId: string;
  fallas: number;
  /** null cuando la ventana observada es menor a MINIMO_OBSERVADO. */
  mtbf: number | null;
  /** Probabilidades 0..1, en el orden de PLAZOS. null si mtbf es null. */
  confiabilidades: (number | null)[];
  ultima: string;
  porEspecialidad: { especialidad: string; cantidad: number }[];
  porMes: { etiqueta: string; cantidad: number }[];
  ritmo: RitmoCambiado | null;
}

export interface Mtbf {
  /** Ordenadas por mtbf ascendente; las de mtbf null van al final. */
  filas: FilaMtbf[];
  /** Días entre la primera falla de la ventana y `hasta`, inclusive. 0 si no hay fallas. */
  diasObservados: number;
  /** Correctivas de la ventana sin equipo enlazado. */
  sinAtribuir: Falla[];
  /** La etiqueta del mes en curso, que va marcado como incompleto. */
  mesEnCurso: string;
}

export function fechaDeFalla(ot: OtCruda): string | null;
export function fallasDeLaVentana(ordenes: OtCruda[], hasta: string): Falla[];
export function confiabilidad(mtbf: number, dias: number): number;
export function calcularMtbf(ordenes: OtCruda[], hasta: string): Mtbf;
```

- [ ] **Step 1: Escribir los tests que fallan**

```ts
import { describe, it, expect } from "vitest";
import { fechaDeFalla, fallasDeLaVentana, confiabilidad, calcularMtbf, type OtCruda } from "./mtbf";

const ot = (p: Partial<OtCruda>): OtCruda => ({
  ot_number: 1, tipo: "CORRECTIVO", fecha: null, fecha_ejecucion: null,
  equipment_id: "eq1", equipo_raw: null, especialidad: "MECÁNICO", ...p,
});

describe("la fecha de una falla", () => {
  it("es la de ejecucion, no la de carga", () => {
    expect(fechaDeFalla(ot({ fecha: "2026-01-19", fecha_ejecucion: "2025-12-25" }))).toBe("2025-12-25");
  });
  it("cae en la de carga solo si no hay ejecucion", () => {
    expect(fechaDeFalla(ot({ fecha: "2026-01-19", fecha_ejecucion: null }))).toBe("2026-01-19");
  });
  it("sin ninguna de las dos no hay falla", () => {
    expect(fechaDeFalla(ot({}))).toBeNull();
  });
});

describe("que entra en la ventana", () => {
  const HASTA = "2026-10-15";
  it("solo las correctivas", () => {
    const r = fallasDeLaVentana([
      ot({ ot_number: 1, tipo: "CORRECTIVO", fecha_ejecucion: "2026-05-01" }),
      ot({ ot_number: 2, tipo: "PROGRAMADO", fecha_ejecucion: "2026-05-01" }),
      ot({ ot_number: 3, tipo: null, fecha_ejecucion: "2026-05-01" }),
    ], HASTA);
    expect(r.map((f) => f.otNumber)).toEqual([1]);
  });
  it("deja afuera lo ejecutado despues de hoy", () => {
    expect(fallasDeLaVentana([ot({ fecha_ejecucion: "2027-03-15" })], HASTA)).toEqual([]);
  });
  it("deja afuera lo anterior a la ventana", () => {
    expect(fallasDeLaVentana([ot({ fecha_ejecucion: "2023-03-06" })], HASTA)).toEqual([]);
  });
  it("conserva las que no tienen equipo", () => {
    const r = fallasDeLaVentana([ot({ equipment_id: null, equipo_raw: "molino viejo", fecha_ejecucion: "2026-05-01" })], HASTA);
    expect(r).toHaveLength(1);
    expect(r[0].equipmentId).toBeNull();
  });
});

describe("la confiabilidad", () => {
  it("es e elevado a menos t sobre el mtbf", () => {
    expect(confiabilidad(4.6, 7)).toBeCloseTo(0.2184, 3);
    expect(confiabilidad(21.3, 7)).toBeCloseTo(0.7199, 3);
  });
  it("a plazo cero es certeza", () => {
    expect(confiabilidad(10, 0)).toBe(1);
  });
});

describe("el calculo completo", () => {
  const HASTA = "2026-10-15";
  // Dos equipos: eq1 falla 4 veces, eq2 una sola. Primera falla 2026-01-01.
  const ORDENES: OtCruda[] = [
    ot({ ot_number: 1, equipment_id: "eq1", fecha_ejecucion: "2026-01-01" }),
    ot({ ot_number: 2, equipment_id: "eq1", fecha_ejecucion: "2026-04-01" }),
    ot({ ot_number: 3, equipment_id: "eq1", fecha_ejecucion: "2026-07-01", especialidad: "ELÉCTRICO" }),
    ot({ ot_number: 4, equipment_id: "eq1", fecha_ejecucion: "2026-10-01" }),
    ot({ ot_number: 5, equipment_id: "eq2", fecha_ejecucion: "2026-06-01" }),
    ot({ ot_number: 6, equipment_id: null, equipo_raw: "sin cargar", fecha_ejecucion: "2026-06-02" }),
  ];

  it("cuenta los dias observados desde la primera falla, no desde los 365", () => {
    // 2026-01-01 a 2026-10-15 inclusive
    expect(calcularMtbf(ORDENES, HASTA).diasObservados).toBe(288);
  });

  it("divide los dias observados por la cantidad de fallas", () => {
    const { filas } = calcularMtbf(ORDENES, HASTA);
    expect(filas[0].equipmentId).toBe("eq1");
    expect(filas[0].fallas).toBe(4);
    expect(filas[0].mtbf).toBeCloseTo(72, 0);
  });

  it("ordena por mtbf ascendente: el que mas falla primero", () => {
    expect(calcularMtbf(ORDENES, HASTA).filas.map((f) => f.equipmentId)).toEqual(["eq1", "eq2"]);
  });

  it("una falla sin equipo no genera fila y queda sin atribuir", () => {
    const r = calcularMtbf(ORDENES, HASTA);
    expect(r.filas.map((f) => f.equipmentId)).not.toContain(null);
    expect(r.sinAtribuir.map((f) => f.otNumber)).toEqual([6]);
  });

  it("reparte por especialidad, de mayor a menor", () => {
    const [eq1] = calcularMtbf(ORDENES, HASTA).filas;
    expect(eq1.porEspecialidad).toEqual([
      { especialidad: "MECÁNICO", cantidad: 3 },
      { especialidad: "ELÉCTRICO", cantidad: 1 },
    ]);
  });

  it("la tendencia trae doce meses, con cero en los que no hubo", () => {
    const [eq1] = calcularMtbf(ORDENES, HASTA).filas;
    expect(eq1.porMes).toHaveLength(12);
    expect(eq1.porMes.every((m) => typeof m.cantidad === "number")).toBe(true);
    // Febrero no tuvo ninguna y tiene que estar igual.
    expect(eq1.porMes.filter((m) => m.cantidad === 0).length).toBeGreaterThan(0);
  });

  it("marca el mes en curso para poder dibujarlo incompleto", () => {
    expect(calcularMtbf(ORDENES, HASTA).mesEnCurso).toBe(calcularMtbf(ORDENES, HASTA).filas[0].porMes[11].etiqueta);
  });

  it("sin ninguna falla no hay filas ni division por cero", () => {
    const r = calcularMtbf([], HASTA);
    expect(r.filas).toEqual([]);
    expect(r.diasObservados).toBe(0);
    expect(r.sinAtribuir).toEqual([]);
  });

  it("con menos de catorce dias observados no publica mtbf", () => {
    const r = calcularMtbf([ot({ fecha_ejecucion: "2026-10-14" })], HASTA);
    expect(r.diasObservados).toBe(2);
    expect(r.filas[0].mtbf).toBeNull();
    expect(r.filas[0].confiabilidades).toEqual([null, null]);
  });

  it("calcula las dos confiabilidades, en el orden de PLAZOS", () => {
    const [eq1] = calcularMtbf(ORDENES, HASTA).filas;
    expect(eq1.confiabilidades).toHaveLength(2);
    expect(eq1.confiabilidades[0]!).toBeGreaterThan(eq1.confiabilidades[1]!);
  });

  it("guarda la fecha de la ultima falla", () => {
    expect(calcularMtbf(ORDENES, HASTA).filas[0].ultima).toBe("2026-10-01");
  });

  /**
   * Dos trabajos distintos de la misma jornada son dos fallas. Agruparlos por
   * dia borraria la diferencia entre una maquina que se para una vez y una que
   * se para tres.
   */
  it("dos fallas del mismo equipo el mismo dia cuentan dos", () => {
    const r = calcularMtbf([
      ot({ ot_number: 1, fecha_ejecucion: "2026-01-01" }),
      ot({ ot_number: 2, fecha_ejecucion: "2026-05-01" }),
      ot({ ot_number: 3, fecha_ejecucion: "2026-05-01" }),
    ], HASTA);
    expect(r.filas[0].fallas).toBe(3);
  });
});

describe("el aviso de ritmo cambiado", () => {
  const HASTA = "2026-10-15";
  const muchas = (fechas: string[]): OtCruda[] =>
    fechas.map((f, i) => ot({ ot_number: i + 1, fecha_ejecucion: f }));

  it("no avisa con menos de seis fallas", () => {
    const r = calcularMtbf(muchas(["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01"]), HASTA);
    expect(r.filas[0].ritmo).toBeNull();
  });

  it("avisa que mejoro cuando el mtbf reciente al menos duplica al de la ventana", () => {
    // 10 fallas en el verano, ninguna en los ultimos 90 dias
    const r = calcularMtbf(muchas([
      "2026-01-05", "2026-01-15", "2026-01-25", "2026-02-05", "2026-02-15",
      "2026-02-25", "2026-03-05", "2026-03-15", "2026-03-25", "2026-04-05",
    ]), HASTA);
    expect(r.filas[0].ritmo?.direccion).toBe("mejoro");
    expect(r.filas[0].ritmo?.mtbfReciente).toBeNull();
    expect(r.filas[0].ritmo?.factor).toBeNull();
  });

  it("avisa que empeoro cuando el mtbf reciente es la mitad o menos", () => {
    // 2 fallas en ocho meses y 6 en los ultimos 90 dias
    const r = calcularMtbf(muchas([
      "2026-01-05", "2026-03-05",
      "2026-08-01", "2026-08-15", "2026-09-01", "2026-09-15", "2026-10-01", "2026-10-10",
    ]), HASTA);
    expect(r.filas[0].ritmo?.direccion).toBe("empeoro");
    expect(r.filas[0].ritmo!.factor!).toBeLessThanOrEqual(0.5);
  });

  it("no avisa cuando el ritmo se mantuvo", () => {
    const r = calcularMtbf(muchas([
      "2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15", "2026-05-15",
      "2026-06-15", "2026-07-15", "2026-08-15", "2026-09-15",
    ]), HASTA);
    expect(r.filas[0].ritmo).toBeNull();
  });
});
```

- [ ] **Step 2: Correr los tests y ver que fallan**

Run: `npx vitest run lib/mantenimiento/mtbf.test.ts`
Expected: FAIL — no existe `lib/mantenimiento/mtbf.ts`.

- [ ] **Step 3: Implementar `lib/mantenimiento/mtbf.ts`**

Las firmas y las constantes están en el bloque **Interfaces** de arriba. Dos decisiones que los tests no determinan solos:

- Los 12 meses de `porMes` salen de `ultimosMeses(new Date(hasta + "T00:00:00"), 12)` de `lib/mantenimiento/dashboard.ts`, que ya resuelve el corte de mes con partes locales; la etiqueta de cada punto es la que esa función devuelve, y `mesEnCurso` es la del último.
- `ritmo` se calcula sólo si `fallas >= MIN_FALLAS_PARA_AVISO` y `mtbf !== null`: se cuentan las fallas de los últimos `DIAS_RECIENTE` días, `mtbfReciente = DIAS_RECIENTE / esas fallas` (null si son cero), y `factor = mtbfReciente / mtbf`. Devuelve `{ direccion: "mejoro" }` cuando no hubo fallas recientes o `factor >= FACTOR_AVISO`, `"empeoro"` cuando `factor <= 1 / FACTOR_AVISO`, y `null` en el medio.

El encabezado del archivo explica, como el resto del módulo, **por qué** el denominador son los días observados y no los 365, y por qué la fecha es `fecha_ejecucion`.

- [ ] **Step 4: Correr los tests y ver que pasan**

Run: `npx vitest run lib/mantenimiento/mtbf.test.ts`
Expected: PASS.

- [ ] **Step 5: Commitear**

```bash
git add lib/mantenimiento/mtbf.ts lib/mantenimiento/mtbf.test.ts
git commit -m "feat(mantenimiento): la cuenta del MTBF y la confiabilidad por equipo"
```

---

### Task 2: La lectura y la ruta

**Files:**
- Create: `lib/mantenimiento/mtbfDatos.ts`
- Create: `app/api/mantenimiento/mtbf/route.ts`

**Interfaces:**
- Consumes: `calcularMtbf`, `VENTANA_DIAS`, `type Mtbf` de Tarea 1; `traerTodo` de `lib/core/paginado.ts`; `puedeVerMantenimiento` de `lib/mantenimiento/auth.ts`.
- Produces:

```ts
/** Lee las OT de la ventana y devuelve la cuenta ya hecha. Usa traerTodo(). */
export async function mtbfDeLaPlanta(
  supabase: SupabaseClient,
  hasta: string
): Promise<Mtbf>;
```

- [ ] **Step 1: Implementar `lib/mantenimiento/mtbfDatos.ts`**

`mtbfDeLaPlanta` arma `desde` restando `VENTANA_DIAS` a `hasta`, trae con `traerTodo()` las `ordenes_trabajo` de `tipo = 'CORRECTIVO'` cuya `fecha_ejecucion` cae en la ventana —el `select()` va literal en la llamada, con `ot_number, tipo, fecha, fecha_ejecucion, equipment_id, equipo_raw, especialidad`— y se lo pasa a `calcularMtbf`.

El filtro de fecha en la consulta es una optimización, no la regla: `calcularMtbf` vuelve a filtrar, porque una OT sin `fecha_ejecucion` tiene que entrar por `fecha` y PostgREST no sabe hacer ese `coalesce`. Traer de más y filtrar en memoria es correcto; traer de menos no.

- [ ] **Step 2: Implementar `app/api/mantenimiento/mtbf/route.ts`**

`GET` sin parámetros. Resuelve el usuario con `createClient()` de `@/lib/supabase/server`, 401 si no hay sesión, 403 si `puedeVerMantenimiento()` da false, y devuelve el `Mtbf` de `mtbfDeLaPlanta(supabase, hoyISO())` —`hoyISO()` de `lib/mantenimiento/alertas.ts`, que ya resuelve el día en hora de Argentina—.

- [ ] **Step 3: Verificar contra la base**

Run: `npx tsc --noEmit`
Expected: sin errores.

Y un script de un solo uso en el scratchpad que llame a `mtbfDeLaPlanta` con el `SUPABASE_SERVICE_ROLE_KEY` de `.env.local` y imprima las cinco primeras filas, los días observados y el largo de `sinAtribuir`.
Expected: `PO-C1-04` primero con **70 fallas**, **166 equipos con fallas** y `sinAtribuir` **49**; esos números no dependen de la fecha. `diasObservados` **no es una constante**: son los días desde la primera correctiva registrada (1/12/2025) hasta hoy, inclusive, así que crece un día por día hasta que la ventana se llene, alrededor del 1/12/2026. Al corte del 15/10/2026 dio **319** y MTBF **4,6** (319 ÷ 70); el 18/10 da 322. No tomar 319 como invariante ni "arreglar" código que anda: verificar contra la cuenta de días de hoy.

Si da 5,2 cuando la cuenta de días observados da 4,6, el denominador se tomó como 365. Si `PY-A1-05` muestra 29 fallas el 19/01, se está leyendo `fecha` en vez de `fecha_ejecucion`. Si las filas son menos de 166, la lectura se cortó en 1000.

- [ ] **Step 4: Commitear**

```bash
git add lib/mantenimiento/mtbfDatos.ts app/api/mantenimiento/mtbf/route.ts
git commit -m "feat(mantenimiento): leer las correctivas de la ventana y servir el MTBF"
```

---

### Task 3: La pantalla del listado

**Files:**
- Create: `app/(app)/mantenimiento/mtbf/page.tsx`
- Create: `app/(app)/mantenimiento/mtbf/MtbfClient.tsx`
- Create: `lib/mantenimiento/mtbfVista.ts`
- Create: `lib/mantenimiento/mtbfVista.test.ts`
- Modify: `lib/core/nav.ts:110`

**Interfaces:**
- Consumes: `mtbfDeLaPlanta` de Tarea 2; `sectoresDePlanta` y `CAMPOS_SECTOR` de `lib/mantenimiento/sectores.ts`; `PLAZOS`, `type FilaMtbf`, `type Mtbf` de Tarea 1.
- Produces:

```ts
export interface EquipoDeLaVista {
  id: string;
  code: string;
  name: string;
  sectorId: string;
  sectorNombre: string;
}

export interface FilaDeVista extends FilaMtbf {
  equipo: EquipoDeLaVista;
}

export interface Filtros { sectorId: string | null; especialidad: string | null }

/** Las filas con su equipo resuelto, ya filtradas. El filtro NO recalcula el MTBF. */
export function filasVisibles(
  filas: FilaMtbf[], equipos: EquipoDeLaVista[], filtros: Filtros
): FilaDeVista[];

/** Los equipos activos que no tienen ninguna fila, ya filtrados. */
export function equiposSinFallas(
  filas: FilaMtbf[], equipos: EquipoDeLaVista[], filtros: Filtros
): EquipoDeLaVista[];
```

- [ ] **Step 1: Escribir los tests que fallan**

```ts
import { describe, it, expect } from "vitest";
import { filasVisibles, equiposSinFallas, type EquipoDeLaVista } from "./mtbfVista";
import type { FilaMtbf } from "./mtbf";

const eq = (id: string, sectorId: string): EquipoDeLaVista =>
  ({ id, code: id.toUpperCase(), name: "Molino " + id, sectorId, sectorNombre: "S " + sectorId });

const fila = (equipmentId: string, p: Partial<FilaMtbf> = {}): FilaMtbf => ({
  equipmentId, fallas: 3, mtbf: 100, confiabilidades: [0.9, 0.7], ultima: "2026-10-01",
  porEspecialidad: [{ especialidad: "MECÁNICO", cantidad: 3 }], porMes: [], ritmo: null, ...p,
});

const EQUIPOS = [eq("a", "s1"), eq("b", "s1"), eq("c", "s2")];

describe("las filas visibles", () => {
  it("resuelve el equipo de cada fila", () => {
    const r = filasVisibles([fila("a")], EQUIPOS, { sectorId: null, especialidad: null });
    expect(r[0].equipo.code).toBe("A");
  });

  it("deja afuera las filas de equipos que ya no estan", () => {
    expect(filasVisibles([fila("zz")], EQUIPOS, { sectorId: null, especialidad: null })).toEqual([]);
  });

  it("filtra por sector", () => {
    const r = filasVisibles([fila("a"), fila("c")], EQUIPOS, { sectorId: "s2", especialidad: null });
    expect(r.map((f) => f.equipmentId)).toEqual(["c"]);
  });

  /** La trampa del spec: el filtro muestra equipos, no recalcula el numero. */
  it("al filtrar por especialidad el mtbf y la cantidad de fallas no cambian", () => {
    const f = fila("a", {
      fallas: 10, mtbf: 30,
      porEspecialidad: [{ especialidad: "MECÁNICO", cantidad: 9 }, { especialidad: "ELÉCTRICO", cantidad: 1 }],
    });
    const r = filasVisibles([f], EQUIPOS, { sectorId: null, especialidad: "ELÉCTRICO" });
    expect(r).toHaveLength(1);
    expect(r[0].fallas).toBe(10);
    expect(r[0].mtbf).toBe(30);
  });

  it("al filtrar por especialidad deja afuera al que no tuvo ninguna de esa clase", () => {
    const r = filasVisibles([fila("a")], EQUIPOS, { sectorId: null, especialidad: "ELÉCTRICO" });
    expect(r).toEqual([]);
  });
});

describe("los equipos sin fallas", () => {
  it("son los activos que no tienen fila", () => {
    const r = equiposSinFallas([fila("a")], EQUIPOS, { sectorId: null, especialidad: null });
    expect(r.map((e) => e.id)).toEqual(["b", "c"]);
  });

  it("respetan el filtro de sector", () => {
    const r = equiposSinFallas([fila("a")], EQUIPOS, { sectorId: "s1", especialidad: null });
    expect(r.map((e) => e.id)).toEqual(["b"]);
  });

  /** Un equipo que nunca fallo no tuvo fallas de ninguna especialidad. */
  it("desaparecen cuando se filtra por especialidad", () => {
    expect(equiposSinFallas([fila("a")], EQUIPOS, { sectorId: null, especialidad: "MECÁNICO" })).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr los tests y ver que fallan**

Run: `npx vitest run lib/mantenimiento/mtbfVista.test.ts`
Expected: FAIL — no existe `lib/mantenimiento/mtbfVista.ts`.

- [ ] **Step 3: Implementar `lib/mantenimiento/mtbfVista.ts`**

Firmas en el bloque **Interfaces**.

- [ ] **Step 4: Correr los tests y ver que pasan**

Run: `npx vitest run lib/mantenimiento/mtbfVista.test.ts`
Expected: PASS.

- [ ] **Step 5: Implementar `page.tsx`**

Server component, con el molde de `app/(app)/mantenimiento/historial/page.tsx`: `createClient()`, `redirect("/login")` sin sesión —el nivel ya lo resuelve el layout del módulo—, y en paralelo `mtbfDeLaPlanta(supabase, hoyISO())`, los equipos activos (`id, code, name, sector_id`) y `sectoresDePlanta(supabase, CAMPOS_SECTOR)`. Arma los `EquipoDeLaVista` y se los pasa a `MtbfClient`.

- [ ] **Step 6: Implementar `MtbfClient.tsx`**

Cliente, sin cuentas propias: ordena y filtra con `filasVisibles` / `equiposSinFallas`.

- Encabezado con la ventana y **el texto fijo**, visible y no en un tooltip: que el MTBF cuenta días de calendario y no horas de máquina, porque las horas de marcha todavía no se cargan.
- Tabla: equipo (nombre + código, linkeado a `/mantenimiento/equipos/<id>`), sector, MTBF, fallas, una columna por plazo de `PLAZOS` (`Llega a 7 d`, `Llega a 30 d`), tendencia y última. Columnas ordenables, orden inicial por MTBF ascendente.
- La tendencia es un SVG `<polyline>` escrito a mano sobre `porMes`, no `recharts`: son 166 filas y un gráfico por fila pesa de más.
- Filtro de sector con `<Select>` (13 opciones) y filtro de especialidad con `<Select>` (3).
- Los equipos sin fallas van al final, en un bloque colapsado, con `sin fallas · MTBF > {diasObservados} d`.
- Al pie, las `sinAtribuir`: número de OT, `equipoRaw` y fecha, en una tabla chica. Sin link al listado de OT.
- Si `filas` viene vacío, un cartel diciendo que no hay correctivas en la ventana. Nada de `NaN`.

- [ ] **Step 7: Agregar la entrada al menú**

En `lib/core/nav.ts`, después de la línea 110 (`Equipos`):

```ts
{ label: "MTBF", href: "/mantenimiento/mtbf", modulo: "mantenimiento" },
```

- [ ] **Step 8: Verificar**

Run: `npx tsc --noEmit && npx vitest run lib/mantenimiento/ && node scripts/revisar-responsive.mjs`
Expected: sin errores, tests en verde, y la tabla nueva sin desbordes — ocho columnas con sparkline es justo lo que ese script marca, así que la tabla va en su propio contenedor con scroll horizontal.

- [ ] **Step 9: Commitear**

```bash
git add lib/mantenimiento/mtbfVista.ts lib/mantenimiento/mtbfVista.test.ts "app/(app)/mantenimiento/mtbf/page.tsx" "app/(app)/mantenimiento/mtbf/MtbfClient.tsx" lib/core/nav.ts
git commit -m "feat(mantenimiento): pantalla de MTBF por equipo"
```

---

### Task 4: La tarjeta en la ficha del equipo

**Files:**
- Create: `app/(app)/mantenimiento/equipos/[id]/ConfiabilidadDelEquipo.tsx`
- Modify: `app/(app)/mantenimiento/equipos/[id]/page.tsx`
- Modify: `app/(app)/mantenimiento/equipos/[id]/EquipoDetalle.tsx:50-55` y `:356`
- Modify: `app/(app)/mantenimiento/GraficosMantenimiento.tsx`

**Interfaces:**
- Consumes: `mtbfDeLaPlanta` de Tarea 2; `PLAZOS`, `type FilaMtbf` de Tarea 1.
- Produces:

```ts
export interface ConfiabilidadProps {
  /** null cuando el equipo no falló en la ventana. */
  fila: FilaMtbf | null;
  diasObservados: number;
  /** La etiqueta del mes en curso, para dibujarlo incompleto. */
  mesEnCurso: string;
}
export default function ConfiabilidadDelEquipo(props: ConfiabilidadProps): JSX.Element;

/** En GraficosMantenimiento.tsx, para cargar con next/dynamic. */
export function FallasPorMes({ datos, mesEnCurso }: {
  datos: { etiqueta: string; cantidad: number }[];
  mesEnCurso: string;
}): JSX.Element;
```

- [ ] **Step 1: Agregar `FallasPorMes` a `GraficosMantenimiento.tsx`**

Un `BarChart` de recharts con el molde de `OtsPorMes`, que ya está en ese archivo: misma grilla, mismos ticks, mismo `TOOLTIP`. La barra cuya `etiqueta` es `mesEnCurso` va con menos opacidad, igual que `OtsPorMes` destaca el mes en curso.

- [ ] **Step 2: Implementar `ConfiabilidadDelEquipo.tsx`**

Cliente. Carga `FallasPorMes` con `next/dynamic` y `ssr: false`, como hace `DashboardClient.tsx:19-22`.

- `fila === null` → la tarjeta dice "sin fallas en la ventana" y `MTBF > {diasObservados} d`. Nada más.
- `fila.mtbf === null` → dice que todavía no hay suficiente historia para publicar el número, con la cantidad de fallas y la fecha de la última.
- Si no, el MTBF grande, las dos confiabilidades como porcentaje en el orden de `PLAZOS`, el gráfico, el pie con fallas / última / reparto por especialidad.
- `fila.ritmo !== null` → el aviso: qué dice el número reciente y en qué dirección cambió. Para `direccion: "mejoro"` con `mtbfReciente` null, el texto es que no falló en los últimos 90 días.
- El mismo texto fijo que el listado sobre días de calendario.

- [ ] **Step 3: Pasar los datos desde `page.tsx`**

En `app/(app)/mantenimiento/equipos/[id]/page.tsx`, sumar `mtbfDeLaPlanta(supabase, hoyISO())` al `Promise.all` existente, quedarse con la fila de este equipo —`filas.find((f) => f.equipmentId === id) ?? null`—, los `diasObservados` y el `mesEnCurso`, y pasárselos a `EquipoDetalle`.

En `EquipoDetalle.tsx`, agregar las dos props a la firma (línea 50-55) y renderizar `<ConfiabilidadDelEquipo />` junto a `<CostoDelEquipo />` en la línea 356, por encima tanto del historial de estados como de la lista de OT.

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit && npm run build`
Expected: sin errores. (Parar `npm run dev` antes del build: con el dev server levantado el build deja la app en 500.)

- [ ] **Step 5: Commitear**

```bash
git add "app/(app)/mantenimiento/equipos/[id]/ConfiabilidadDelEquipo.tsx" "app/(app)/mantenimiento/equipos/[id]/page.tsx" "app/(app)/mantenimiento/equipos/[id]/EquipoDetalle.tsx" "app/(app)/mantenimiento/GraficosMantenimiento.tsx"
git commit -m "feat(mantenimiento): confiabilidad y tendencia en la ficha del equipo"
```

---

### Task 5: El recuadro del tablero

**Files:**
- Modify: `app/(app)/mantenimiento/DashboardClient.tsx`

**Interfaces:**
- Consumes: `GET /api/mantenimiento/mtbf` de Tarea 2; `useCargar` de `lib/core/useCargar.ts`.

- [ ] **Step 1: Implementar el recuadro**

Un componente nuevo dentro de `DashboardClient.tsx`, al lado de `OrdenesAtrasadas` y `VentanasDeReparacion`.

**Pide los datos con `useCargar` después del primer pintado**, no se los pasa el servidor: el tablero fue limpiado a propósito de traer miles de filas para contarlas en memoria, y este recuadro necesita las ~900 correctivas. Mientras carga muestra el esqueleto; si el pedido falla, el recuadro no aparece y el resto del tablero sigue igual.

Muestra las cinco primeras filas con nombre, código, MTBF y un link a la ficha, y abajo un link a `/mantenimiento/mtbf`. Las filas con `mtbf === null` no entran: no tienen número que mostrar.

- [ ] **Step 2: Verificar en el navegador**

Levantar el preview, abrir `/mantenimiento` y confirmar que el tablero pinta completo **antes** de que aparezca el recuadro, y que el recuadro llega después con los cinco molinos. Revisar la consola y la pestaña de red: un solo pedido a `/api/mantenimiento/mtbf`, sin errores.

- [ ] **Step 3: Commitear**

```bash
git add "app/(app)/mantenimiento/DashboardClient.tsx"
git commit -m "feat(mantenimiento): los cinco peores por MTBF en el tablero"
```

---

### Task 6: Cierre

- [ ] **Step 1: Las cuatro verificaciones**

```bash
npm test
npx tsc --noEmit
npm run build
node scripts/revisar-arbol-commiteado.mjs
```

Expected: las cuatro en verde. La última es la que atrapa lo que las otras no pueden: un archivo nuevo que quedó staged y nunca se commiteó no viaja, y el build local no lo reproduce.

- [ ] **Step 2: Documentar**

Agregar Mantenimiento → MTBF a la tabla de documentos de `CLAUDE.md`, apuntando al spec y a este plan.

- [ ] **Step 3: Commitear y pushear**

```bash
git add CLAUDE.md
git commit -m "docs(mantenimiento): el MTBF en la tabla de documentos"
git push
```
