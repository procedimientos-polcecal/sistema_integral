# La planilla manda sobre el stock de carbonilla — plan de implementación

> **Para quien lo ejecute:** usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans`, tarea por tarea. Los pasos usan `- [ ]` para poder tacharlos.

**Objetivo:** que el stock de carbonilla del SdG diga lo mismo que la planilla, leyendo de ahí las entradas y las salidas, y que Odoo pase de crear movimientos a avisar qué camión no tiene orden de compra.

**Arquitectura:** una sincronización lee `Entradas  Salidas` y crea los movimientos de las filas que todavía no son de ninguno; el espejo sigue escribiendo del otro lado cuando alguien carga en la app, y guarda el número de fila. **`sheets_fila` es lo único que evita que lo escrito vuelva a entrar.** La conciliación contra Odoo no se guarda: se calcula al abrirla.

**Spec:** [`docs/superpowers/specs/2026-10-13-calidad-la-planilla-manda-design.md`](../specs/2026-10-13-calidad-la-planilla-manda-design.md). **Leerlo antes de empezar** — tiene las mediciones que explican por qué se da vuelta la dirección.

**Stack:** Next.js 16 (App Router) · Supabase (Postgres + RLS) · vitest · Google Sheets vía `lib/core/sheets.ts` · Odoo por JSON-RPC vía `lib/odoo/client.ts`.

## Global Constraints

- Todo en **castellano**: nombres, comentarios, mensajes de pantalla y de commit.
- **Nunca `git add -A`.** Agregá por nombre los archivos de la tarea. Hay otra sesión en el árbol: al 13/10/2026 tenía 42 archivos sin commitear.
- Las migraciones **las corre una persona** en el editor SQL de Supabase. Escribirla y quedar a la espera.
- **Un valor nuevo de enum viaja solo** en su archivo (`55P04`). Acá no hace falta ninguno.
- Toda lectura de una tabla que crece va con **`traerTodo()`** de `lib/core/paginado.ts`: PostgREST corta en 1000 y no avisa. `calidad_movimientos` tiene 1.049.
- Un **`.in()` con muchos ids** lo rechaza PostgREST con un 400 mudo: de a lotes de 200.
- Un **`select()` armado en una variable** pierde la inferencia de tipos: la cadena va literal.
- Un desplegable se escribe **`<Select>`**, no `<select>` (`components/Select.tsx`).
- **La planilla de producción se lee, no se escribe** desde local. Las corridas que escriben se prueban contra la base y con el espejo apagado.

## Review Focus

Cinco casos que el spec implica y que ningún paso cubriría solo. Cada uno tiene su test en la tarea que es dueña del código:

1. **Una fila con número en `ENTRADAS` y en `SALIDAS` a la vez.** `movimientoDesdeElRenglon` toma la entrada y **pierde la salida en silencio**. Antes daba igual —la importación corrió una vez y nadie miró— ahora entraría mal todos los días. → Tarea 2.
2. **Una fila ya leída cuyo contenido cambió en la planilla.** El spec dice que así se ve si alguien corrigió una fila vieja, pero mirar sólo las ocupadas no lo detecta. → Tarea 2.
3. **La planilla devuelve menos filas que las ocupadas** (alguien borró del final). `sheets_fila` apunta fuera del array: no puede romper ni crear nada. → Tarea 2.
4. **Google falla a mitad de la lectura.** La corrida no puede dejar el libro a medias ni anotarse como `ok`. → Tarea 3.
5. **Un camión sin orden en Odoo y una orden sin camión el mismo día.** La conciliación no puede aparearlos entre sí por cercanía. → Tarea 4.

---

## Mapa de archivos

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/<ts>_calidad_bandeja_de_la_planilla.sql` | Crea `calidad_planilla_sin_reconocer`; borra `calidad_odoo_sin_reconocer` |
| `lib/calidad/types.ts` | `FilaSinReconocer` reemplaza a `LineaSinReconocer` |
| `lib/calidad/desdeLaPlanilla.ts` | **Nuevo.** `filasPorLeer()` puro, y la corrida que lee Sheets y escribe |
| `lib/calidad/conciliacion.ts` | **Nuevo.** `desviosContraOdoo()` puro |
| `lib/calidad/sincronizar.ts` | Deja de insertar: cuenta desvíos. Se va `CALIDAD_DESDE` |
| `lib/calidad/consultas.ts` | `traerBandeja` apunta a la tabla nueva |
| `lib/calidad/desdeLaRecepcion.ts` | Exporta a la planilla y se queda con `sheets_fila` |
| `app/api/cron/calidad-sync/route.ts` | Lee la planilla y después controla contra Odoo |
| `app/api/calidad/sincronizar/route.ts` | Lo mismo, desde el botón |
| `app/(app)/calidad/carbonilla/StockClient.tsx` | La bandeja cambia de forma |
| `app/(app)/calidad/conciliacion/**` | **Nueva.** La pantalla de control contra Odoo |
| `docs/CALIDAD.md` · `CLAUDE.md` | La dirección nueva |

**Se usa y no se reescribe:** `movimientoDesdeElRenglon` (`lib/calidad/importar.ts`, 14 tests), `exportarMovimiento` y `escribirMovimiento` (`lib/calidad/espejo.ts`), `movimientoDesdeLaLineaDeOdoo` (`lib/calidad/reconocer.ts`), `leerValores` (`lib/core/sheets.ts`), `traerTodo`, `registrarSincronizacion`.

---

## Tarea 1: La migración de la bandeja

**Archivos:**
- Crear: `supabase/migrations/<timestamp>_calidad_bandeja_de_la_planilla.sql`

- [ ] **Paso 1: Generar el archivo**

```bash
npm run migracion "calidad bandeja de la planilla"
```

- [ ] **Paso 2: Escribirlo**

```sql
-- ============================================================
-- SdG — Calidad: la bandeja ahora es de la planilla, no de Odoo
--
-- Odoo deja de crear movimientos, así que no hay más "líneas de Odoo sin
-- reconocer". Lo que sí hay que ver son FILAS DE LA PLANILLA que no se
-- pudieron convertir, y ésas se identifican por número de fila.
--
-- La tabla vieja se borra en vez de quedar vacía: tiene 0 filas, y una tabla
-- muerta con nombre vigente es de las trampas que más caro salen de encontrar
-- meses después.
--
-- Diseño: docs/superpowers/specs/2026-10-13-calidad-la-planilla-manda-design.md
-- ============================================================

create table public.calidad_planilla_sin_reconocer (
  -- La fila de `Entradas  Salidas`, que es la clave natural: la planilla se
  -- escribe siempre al final (medido: 0 filas fuera de orden cronológico en
  -- 3.399), así que el número no se mueve.
  fila            integer primary key,
  fecha           date,
  codigo          text,
  descripcion     text,
  entradas        numeric(12,3),
  salidas         numeric(12,3),
  motivo          text not null,
  visto_en        timestamptz not null default now()
);

create index calidad_planilla_sin_reconocer_fecha
  on public.calidad_planilla_sin_reconocer (fecha);

alter table public.calidad_planilla_sin_reconocer enable row level security;

create policy calidad_planilla_sin_reconocer_leer
  on public.calidad_planilla_sin_reconocer
  for select using (tiene_acceso_calidad());

create policy calidad_planilla_sin_reconocer_escribir
  on public.calidad_planilla_sin_reconocer
  for all using (puede_editar_calidad()) with check (puede_editar_calidad());

-- Y la de Odoo se va. Tiene 0 filas.
drop table if exists public.calidad_odoo_sin_reconocer;
```

- [ ] **Paso 3: Commitear y quedar a la espera**

```bash
git add supabase/migrations/<timestamp>_calidad_bandeja_de_la_planilla.sql
git commit -m "feat(calidad): la bandeja pasa a ser de la planilla y no de Odoo"
```

Decíle al usuario que la corra. **Las tareas 3 en adelante no se pueden probar contra la base hasta entonces**, pero las puras (2 y 4) sí.

---

## Tarea 2: Qué filas hay que leer

**Archivos:**
- Crear: `lib/calidad/desdeLaPlanilla.ts`
- Test: `lib/calidad/desdeLaPlanilla.test.ts`

**Interfaces:**
- Consume: nada.
- Produce: `filasPorLeer(ocupadas: Map<number, FilaOcupada>, filas: unknown[][]): PorLeer` y los tipos `FilaOcupada` y `PorLeer`.

- [ ] **Paso 1: Escribir el test que falla**

`lib/calidad/desdeLaPlanilla.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { filasPorLeer, type FilaOcupada } from "./desdeLaPlanilla";

// CODIGO, DESCRIPCION, ENTRADAS, SALIDAS, TOTAL, VEGETAL, RESIDUAL, FECHA
const fila = (codigo: string, entradas: number | "", salidas: number | "", serial: number) =>
  [codigo, "", entradas, salidas, "", "", "", serial];

/** 46276 = 2026-09-11; 46277 = 2026-09-12. */
const LUNES = 46276;
const MARTES = 46277;

/** La planilla entera: encabezado y tres renglones, filas 1 a 4. */
const PLANILLA = [
  ["CODIGO", "DESCRIPCION", "ENTRADAS", "SALIDAS"],
  fila("00003", 20.58, "", LUNES),
  fila("00015", "", 37, LUNES),
  fila("00007", 19.14, "", MARTES),
];

const ocupada = (fila: number, fecha: string, entradas: number | null, salidas: number | null): [number, FilaOcupada] => [
  fila,
  { fecha, entradas, salidas },
];

describe("filasPorLeer", () => {
  it("devuelve las filas que todavía no son de ningún movimiento", () => {
    const r = filasPorLeer(new Map([ocupada(2, "2026-09-11", 20.58, null)]), PLANILLA);
    expect(r.nuevas.map((n) => n.fila)).toEqual([3, 4]);
  });

  it("una fila ocupada no se vuelve a leer: es lo único que evita el lazo", () => {
    const todas = new Map([
      ocupada(2, "2026-09-11", 20.58, null),
      ocupada(3, "2026-09-11", null, 37),
      ocupada(4, "2026-09-12", 19.14, null),
    ]);
    expect(filasPorLeer(todas, PLANILLA).nuevas).toEqual([]);
  });

  it("salta el encabezado", () => {
    expect(filasPorLeer(new Map(), PLANILLA).nuevas.map((n) => n.fila)).toEqual([2, 3, 4]);
  });

  it("una fila vacía no es una fila nueva", () => {
    const conHuecos = [...PLANILLA, ["", ""], ["", " "]];
    expect(filasPorLeer(new Map(), conHuecos).nuevas.map((n) => n.fila)).toEqual([2, 3, 4]);
  });

  // Review Focus 1.
  it("una fila con entrada Y salida a la vez no se importa: se informa", () => {
    // `movimientoDesdeElRenglon` toma la entrada y pierde la salida en
    // silencio. En una importación de una vez nadie lo miró; corriendo todos
    // los días, ese renglón entraría mal para siempre.
    const rara = [...PLANILLA, fila("00003", 20.58, 37, MARTES)];
    const r = filasPorLeer(new Map(), rara);
    expect(r.nuevas.map((n) => n.fila)).toEqual([2, 3, 4]);
    expect(r.ambiguas).toHaveLength(1);
    expect(r.ambiguas[0].fila).toBe(5);
    expect(r.ambiguas[0].motivo).toMatch(/entrada y salida/i);
  });

  // Review Focus 2.
  it("avisa cuando una fila ya leída cambió de contenido en la planilla", () => {
    // Alguien corrigió 20,58 por 21,58 en una fila que el SdG ya importó. No
    // se corrige sola —el saldo de todo lo que sigue cambiaría— pero tiene que
    // verse.
    const r = filasPorLeer(new Map([ocupada(2, "2026-09-11", 21.58, null)]), PLANILLA);
    expect(r.cambiadas).toHaveLength(1);
    expect(r.cambiadas[0].fila).toBe(2);
    expect(r.cambiadas[0].motivo).toContain("21.58");
    expect(r.cambiadas[0].motivo).toContain("20.58");
  });

  it("una fila ocupada que no cambió no se informa", () => {
    const r = filasPorLeer(new Map([ocupada(2, "2026-09-11", 20.58, null)]), PLANILLA);
    expect(r.cambiadas).toEqual([]);
  });

  // Review Focus 3.
  it("si la planilla devuelve menos filas que las ocupadas, no rompe ni crea nada", () => {
    const masAllaDelFinal = new Map([ocupada(2, "2026-09-11", 20.58, null), ocupada(99, "2026-09-11", 1, null)]);
    const r = filasPorLeer(masAllaDelFinal, PLANILLA);
    expect(r.nuevas.map((n) => n.fila)).toEqual([3, 4]);
    expect(r.desaparecidas).toEqual([99]);
  });

  it("una planilla vacía no es un error", () => {
    expect(filasPorLeer(new Map(), [])).toEqual({
      nuevas: [],
      cambiadas: [],
      ambiguas: [],
      desaparecidas: [],
    });
  });
});
```

- [ ] **Paso 2: Correr y verificar que falla**

```bash
npx vitest run lib/calidad/desdeLaPlanilla.test.ts
```

Esperado: FAIL, `Failed to resolve import "./desdeLaPlanilla"`.

- [ ] **Paso 3: Implementar**

`lib/calidad/desdeLaPlanilla.ts`:

```ts
import { fechaDeSheets } from "@/lib/core/fechaDeSheets";

/**
 * Qué filas de la planilla hay que convertir en movimientos.
 *
 * Función pura: no habla con Sheets ni con Supabase. La corrida que sí lo hace
 * vive más abajo en este mismo archivo.
 *
 * **`sheets_fila` es lo único que evita el lazo.** Cuando alguien carga un
 * consumo en la app, el espejo escribe la fila y guarda su número; acá esa fila
 * figura como ocupada y no se vuelve a crear. No hay una segunda defensa —ni
 * una marca en la planilla, ni comparar contenidos— y es a propósito: una marca
 * más es una cosa más que mantener.
 *
 * Que el número de fila sirva como clave está medido: 0 filas fuera de orden
 * cronológico en 3.399, y 1.000 de 1.000 filas importadas siguen diciendo lo
 * mismo. La planilla se escribe siempre al final.
 *
 * Spec: docs/superpowers/specs/2026-10-13-calidad-la-planilla-manda-design.md
 */

/** Las columnas de `Entradas  Salidas`, por índice. */
const COL = { codigo: 0, descripcion: 1, entradas: 2, salidas: 3, fecha: 7 } as const;

/** Lo que el SdG ya guardó de una fila que leyó. */
export interface FilaOcupada {
  fecha: string;
  /** Positivas, como están en la planilla. `null` si esa columna estaba vacía. */
  entradas: number | null;
  salidas: number | null;
}

export interface FilaNueva {
  fila: number;
  celdas: unknown[];
}

export interface FilaConProblema {
  fila: number;
  fecha: string | null;
  codigo: string;
  descripcion: string;
  entradas: number | null;
  salidas: number | null;
  motivo: string;
}

export interface PorLeer {
  /** Las que hay que convertir con `movimientoDesdeElRenglon`. */
  nuevas: FilaNueva[];
  /** Ya leídas y con otro contenido ahora. No se corrigen solas: se informan. */
  cambiadas: FilaConProblema[];
  /** Con número en las dos columnas: no se sabe si es entrada o salida. */
  ambiguas: FilaConProblema[];
  /** Ocupadas que ya no existen en la planilla. */
  desaparecidas: number[];
}

function numero(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function describir(fila: number, celdas: unknown[], motivo: string): FilaConProblema {
  return {
    fila,
    fecha: fechaDeSheets(celdas[COL.fecha]),
    codigo: String(celdas[COL.codigo] ?? "").trim(),
    descripcion: String(celdas[COL.descripcion] ?? "").trim(),
    entradas: numero(celdas[COL.entradas]),
    salidas: numero(celdas[COL.salidas]),
    motivo,
  };
}

/** Tres decimales, que es `numeric(12,3)` en la base. */
function igual(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 0.0005;
}

export function filasPorLeer(
  ocupadas: Map<number, FilaOcupada>,
  filas: unknown[][]
): PorLeer {
  const nuevas: FilaNueva[] = [];
  const cambiadas: FilaConProblema[] = [];
  const ambiguas: FilaConProblema[] = [];

  // La fila 1 es el encabezado; se cuenta desde 1, como la ve una persona.
  filas.slice(1).forEach((celdas, i) => {
    const fila = i + 2;

    const codigo = String(celdas[COL.codigo] ?? "").trim();
    const descripcion = String(celdas[COL.descripcion] ?? "").trim();
    if (!codigo && !descripcion) return;

    const entradas = numero(celdas[COL.entradas]);
    const salidas = numero(celdas[COL.salidas]);

    const ya = ocupadas.get(fila);
    if (ya) {
      // No se corrige sola: cambiar una fila vieja mueve el saldo de todo lo
      // que vino después. Se informa y lo decide una persona.
      if (!igual(ya.entradas, entradas) || !igual(ya.salidas, salidas)) {
        cambiadas.push(
          describir(
            fila,
            celdas,
            `La planilla dice entradas ${entradas ?? "—"} y salidas ${salidas ?? "—"}; ` +
              `el SdG había leído entradas ${ya.entradas ?? "—"} y salidas ${ya.salidas ?? "—"}.`
          )
        );
      }
      return;
    }

    // Con número en las dos columnas no se sabe qué es, y `movimientoDesdeElRenglon`
    // tomaría la entrada perdiendo la salida en silencio.
    if (entradas !== null && entradas !== 0 && salidas !== null && salidas !== 0) {
      ambiguas.push(
        describir(fila, celdas, "La fila tiene entrada y salida a la vez: no se sabe cuál es.")
      );
      return;
    }

    nuevas.push({ fila, celdas });
  });

  // Que una ocupada ya no exista no rompe nada ni crea nada: se informa.
  const desaparecidas = [...ocupadas.keys()].filter((f) => f > filas.length).sort((a, b) => a - b);

  return { nuevas, cambiadas, ambiguas, desaparecidas };
}
```

- [ ] **Paso 4: Correr y verificar**

```bash
npx vitest run lib/calidad/desdeLaPlanilla.test.ts
```

Esperado: 9 tests en verde.

- [ ] **Paso 5: Commitear**

```bash
git add lib/calidad/desdeLaPlanilla.ts lib/calidad/desdeLaPlanilla.test.ts
git commit -m "feat(calidad): que filas de la planilla hay que leer, y cuales avisan"
```

---

## Tarea 3: La corrida que lee la planilla

**Archivos:**
- Modificar: `lib/calidad/desdeLaPlanilla.ts`
- Modificar: `lib/calidad/types.ts`
- Modificar: `lib/calidad/consultas.ts`

**Interfaces:**
- Consume: `filasPorLeer` (tarea 2), `movimientoDesdeElRenglon` (`lib/calidad/importar.ts`), `traerCarbonilleros` y `traerMovimientos` (`lib/calidad/consultas.ts`).
- Produce: `leerLaPlanilla(supabase): Promise<ResumenDeLectura>` y `traerBandeja(supabase): Promise<FilaSinReconocer[]>`.

- [ ] **Paso 1: Cambiar el tipo de la bandeja**

En `lib/calidad/types.ts`, **reemplazar** `LineaSinReconocer` por:

```ts
/** Una fila de la planilla que no se pudo convertir en movimiento. */
export interface FilaSinReconocer {
  fila: number;
  fecha: string | null;
  codigo: string | null;
  descripcion: string | null;
  entradas: number | null;
  salidas: number | null;
  motivo: string;
  visto_en: string;
}
```

- [ ] **Paso 2: Apuntar `traerBandeja` a la tabla nueva**

En `lib/calidad/consultas.ts`, cambiar el cuerpo de `traerBandeja` (la cadena del `select` va **literal**, no en una variable):

```ts
export async function traerBandeja(supabase: SupabaseClient): Promise<FilaSinReconocer[]> {
  return traerTodo<FilaSinReconocer>((desde, hasta) =>
    supabase
      .from("calidad_planilla_sin_reconocer")
      .select("fila, fecha, codigo, descripcion, entradas, salidas, motivo, visto_en")
      .order("fila", { ascending: false })
      .range(desde, hasta)
  );
}
```

Y cambiar el import de `LineaSinReconocer` por `FilaSinReconocer`.

- [ ] **Paso 3: Escribir la corrida**

Agregar al final de `lib/calidad/desdeLaPlanilla.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerValores } from "@/lib/core/sheets";
import { movimientoDesdeElRenglon, type CatalogoDeLaPlanilla } from "./importar";
import { traerCarbonilleros, traerMovimientos } from "./consultas";

/** La pestaña de datos. Lleva dos espacios en el medio, y no es un error. */
export const PESTANA = "Entradas  Salidas";

const PLANILLA = () => process.env.GOOGLE_SHEETS_STOCK_CARBONILLA_ID ?? "";

export interface ResumenDeLectura {
  filasLeidas: number;
  nuevos: number;
  cambiadas: number;
  ambiguas: number;
  desaparecidas: number;
  sinReconocer: number;
}

/**
 * Traer de la planilla los movimientos que el libro todavía no tiene.
 *
 * **Lee la planilla entera**, no los últimos N días: son 3.399 filas y una sola
 * lectura, y `sheets_fila` resuelve mejor que una fecha qué hace falta.
 *
 * Lanza si Google falla, y eso es a propósito: quien la llama tiene que
 * anotarse como `ok: false` en `sincronizaciones`. Una corrida que falla a
 * mitad y se anota bien es peor que una que falla fuerte — deja el libro a
 * medias sin que nada avise.
 */
export async function leerLaPlanilla(supabase: SupabaseClient): Promise<ResumenDeLectura> {
  if (!PLANILLA()) {
    throw new Error(
      "Falta GOOGLE_SHEETS_STOCK_CARBONILLA_ID: sin eso no se puede leer la planilla de stock."
    );
  }

  const [carbonilleros, movimientos] = await Promise.all([
    traerCarbonilleros(supabase),
    traerMovimientos(supabase),
  ]);

  const catalogo: CatalogoDeLaPlanilla = new Map(
    carbonilleros.map((c) => [c.codigo_planilla, { id: c.id, carbon: c.carbon }])
  );

  // Lo que el SdG ya leyó de cada fila. El signo se devuelve a positivo para
  // poder compararlo con las columnas de la planilla, que no tienen signo.
  const ocupadas = new Map<number, FilaOcupada>();
  for (const m of movimientos) {
    if (m.sheets_fila === null) continue;
    const t = Number(m.toneladas);
    ocupadas.set(m.sheets_fila, {
      fecha: m.fecha,
      entradas: t > 0 ? t : null,
      salidas: t < 0 ? -t : null,
    });
  }

  const filas = await leerValores(PLANILLA(), PESTANA, { sinFormato: true });
  const r = filasPorLeer(ocupadas, filas);

  const nuevos: Record<string, unknown>[] = [];
  const problemas = [...r.cambiadas, ...r.ambiguas];

  for (const n of r.nuevas) {
    const conv = movimientoDesdeElRenglon(n.celdas, n.fila, catalogo);
    if (conv.clase === "vacia") continue;
    if (conv.clase === "sin_importar") {
      problemas.push(describir(n.fila, n.celdas, conv.motivo));
      continue;
    }
    // `origen` pasa a ser 'importacion' también acá: el movimiento viene de la
    // planilla, que es de donde venían los 1.047 de septiembre.
    nuevos.push({ ...conv.movimiento, cargado_por: null });
  }

  for (let i = 0; i < nuevos.length; i += 500) {
    const { error } = await supabase.from("calidad_movimientos").insert(nuevos.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }

  // La bandeja se rehace entera en cada corrida: lo que se arregló en la
  // planilla deja de figurar solo, sin que nadie tenga que borrarlo.
  await supabase.from("calidad_planilla_sin_reconocer").delete().gte("fila", 0);
  if (problemas.length) {
    const { error } = await supabase.from("calidad_planilla_sin_reconocer").insert(
      problemas.map((p) => ({
        fila: p.fila,
        fecha: p.fecha,
        codigo: p.codigo,
        descripcion: p.descripcion,
        entradas: p.entradas,
        salidas: p.salidas,
        motivo: p.motivo,
      }))
    );
    if (error) throw new Error(error.message);
  }

  return {
    filasLeidas: filas.length,
    nuevos: nuevos.length,
    cambiadas: r.cambiadas.length,
    ambiguas: r.ambiguas.length,
    desaparecidas: r.desaparecidas.length,
    sinReconocer: problemas.length,
  };
}
```

- [ ] **Paso 4: Verificar y commitear**

```bash
npx tsc --noEmit
npm test
git add lib/calidad/desdeLaPlanilla.ts lib/calidad/types.ts lib/calidad/consultas.ts
git commit -m "feat(calidad): la corrida que trae los movimientos de la planilla"
```

`tsc` va a marcar los usos viejos de `LineaSinReconocer` en las rutas y en la pantalla. **Son de las tareas 6 y 8**: dejalos rotos y seguí, o adelantá esas dos. Lo que **no** hay que hacer es tocar archivos de otros módulos para que compile.

---

## Tarea 4: Los desvíos contra Odoo

**Archivos:**
- Crear: `lib/calidad/conciliacion.ts`
- Test: `lib/calidad/conciliacion.test.ts`

**Interfaces:**
- Consume: nada.
- Produce: `desviosContraOdoo(camiones: CamionDelLibro[], lineas: LineaDeOdooParaControl[]): Desvios`.

- [ ] **Paso 1: Escribir el test que falla**

`lib/calidad/conciliacion.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { desviosContraOdoo, type CamionDelLibro, type LineaDeOdooParaControl } from "./conciliacion";

const camion = (fecha: string, partner: number, toneladas: number, id = fecha + partner + toneladas): CamionDelLibro =>
  ({ id, fecha, odooPartnerId: partner, toneladas });

const linea = (fecha: string, partner: number, cantidad: number, orden = "P0" + partner): LineaDeOdooParaControl =>
  ({ ordenNombre: orden, fecha, partnerId: partner, partnerNombre: "PROVEEDOR", cantidad });

describe("desviosContraOdoo", () => {
  it("un camión con su orden del mismo día y cantidad no es desvío", () => {
    const r = desviosContraOdoo([camion("2026-10-01", 906, 19.58)], [linea("2026-10-01", 906, 19.58)]);
    expect(r.sinOrden).toEqual([]);
    expect(r.sinCamion).toEqual([]);
    expect(r.cantidadDistinta).toEqual([]);
  });

  it("un camión sin orden es el desvío que importa: no se puede facturar", () => {
    const r = desviosContraOdoo([camion("2026-10-08", 906, 17.12)], []);
    expect(r.sinOrden).toHaveLength(1);
    expect(r.sinOrden[0].fecha).toBe("2026-10-08");
  });

  it("una orden sin camión también se informa", () => {
    const r = desviosContraOdoo([], [linea("2026-10-08", 906, 17.12, "P02500")]);
    expect(r.sinCamion).toHaveLength(1);
    expect(r.sinCamion[0].ordenNombre).toBe("P02500");
  });

  it("el mismo camión con cantidad distinta aparea y se informa", () => {
    // Lo medido: 60 de 575 en el año difieren por decenas de kilos.
    const r = desviosContraOdoo([camion("2026-09-01", 906, 16.5)], [linea("2026-09-01", 906, 16.6)]);
    expect(r.sinOrden).toEqual([]);
    expect(r.sinCamion).toEqual([]);
    expect(r.cantidadDistinta).toHaveLength(1);
    expect(r.cantidadDistinta[0].enElLibro).toBe(16.5);
    expect(r.cantidadDistinta[0].enOdoo).toBe(16.6);
  });

  it("aparea con hasta dos días de diferencia, que es lo que tarda Odoo", () => {
    const r = desviosContraOdoo([camion("2026-10-01", 906, 19.58)], [linea("2026-10-03", 906, 19.58)]);
    expect(r.sinOrden).toEqual([]);
    expect(r.sinCamion).toEqual([]);
  });

  // Review Focus 5.
  it("no aparea un camión de un proveedor con la orden de otro", () => {
    // Dos desvíos el mismo día no son un match: aparearlos por cercanía es
    // exactamente el cruce que este módulo existe para eliminar.
    const r = desviosContraOdoo([camion("2026-10-08", 906, 17.12)], [linea("2026-10-08", 1056, 17.12)]);
    expect(r.sinOrden).toHaveLength(1);
    expect(r.sinCamion).toHaveLength(1);
    expect(r.cantidadDistinta).toEqual([]);
  });

  it("dos camiones iguales del mismo día consumen dos órdenes, no una", () => {
    const r = desviosContraOdoo(
      [camion("2026-10-08", 906, 17.12, "a"), camion("2026-10-08", 906, 17.12, "b")],
      [linea("2026-10-08", 906, 17.12)]
    );
    expect(r.sinOrden).toHaveLength(1);
  });

  it("sin camiones y sin órdenes no hay desvíos", () => {
    expect(desviosContraOdoo([], [])).toEqual({ sinOrden: [], sinCamion: [], cantidadDistinta: [] });
  });
});
```

- [ ] **Paso 2: Correr y verificar que falla**

```bash
npx vitest run lib/calidad/conciliacion.test.ts
```

Esperado: FAIL, `Failed to resolve import "./conciliacion"`.

- [ ] **Paso 3: Implementar**

`lib/calidad/conciliacion.ts`:

```ts
/**
 * El libro contra Odoo: qué camión no tiene orden de compra.
 *
 * **Es una vista, no un estado.** Se calcula al abrirla y no se guarda: un
 * derivado guardado se desincroniza y nada avisa, que es la regla que este
 * módulo ya tiene escrita para los saldos.
 *
 * Odoo dejó de crear movimientos el 13/10/2026 — la planilla manda— y pasó a
 * ser esto: el único lugar que dice que un camión entró sin orden de compra,
 * que es plata que después no se puede facturar.
 *
 * Spec: docs/superpowers/specs/2026-10-13-calidad-la-planilla-manda-design.md
 */

/** Cuánto puede tardar Odoo en recibir la orden de un camión ya pesado. */
const DIAS_DE_GRACIA = 2;

export interface CamionDelLibro {
  id: string;
  fecha: string;
  odooPartnerId: number;
  /** Positiva. */
  toneladas: number;
}

export interface LineaDeOdooParaControl {
  ordenNombre: string;
  fecha: string;
  partnerId: number;
  partnerNombre: string;
  cantidad: number;
}

export interface CantidadDistinta {
  camionId: string;
  fecha: string;
  ordenNombre: string;
  enElLibro: number;
  enOdoo: number;
}

export interface Desvios {
  /** En la planilla y sin orden de compra. **No se puede facturar.** */
  sinOrden: CamionDelLibro[];
  /** En Odoo y sin camión en el libro. */
  sinCamion: LineaDeOdooParaControl[];
  cantidadDistinta: CantidadDistinta[];
}

function dias(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

export function desviosContraOdoo(
  camiones: CamionDelLibro[],
  lineas: LineaDeOdooParaControl[]
): Desvios {
  const libres = lineas.map((l) => ({ l, usada: false }));

  const sinOrden: CamionDelLibro[] = [];
  const cantidadDistinta: CantidadDistinta[] = [];

  for (const c of camiones) {
    // El proveedor tiene que ser el mismo. Aparear por fecha y cantidad entre
    // proveedores distintos es el cruce que este módulo existe para eliminar.
    const candidatas = libres.filter(
      (x) => !x.usada && x.l.partnerId === c.odooPartnerId && dias(x.l.fecha, c.fecha) <= DIAS_DE_GRACIA
    );
    if (candidatas.length === 0) {
      sinOrden.push(c);
      continue;
    }

    // La más parecida en cantidad: así dos camiones del mismo día no se roban
    // la orden del otro.
    candidatas.sort((a, b) => Math.abs(a.l.cantidad - c.toneladas) - Math.abs(b.l.cantidad - c.toneladas));
    const elegida = candidatas[0];
    elegida.usada = true;

    if (Math.abs(elegida.l.cantidad - c.toneladas) >= 0.005) {
      cantidadDistinta.push({
        camionId: c.id,
        fecha: c.fecha,
        ordenNombre: elegida.l.ordenNombre,
        enElLibro: c.toneladas,
        enOdoo: elegida.l.cantidad,
      });
    }
  }

  return {
    sinOrden,
    sinCamion: libres.filter((x) => !x.usada).map((x) => x.l),
    cantidadDistinta,
  };
}
```

- [ ] **Paso 4: Correr y verificar**

```bash
npx vitest run lib/calidad/conciliacion.test.ts
```

Esperado: 8 tests en verde.

- [ ] **Paso 5: Commitear**

```bash
git add lib/calidad/conciliacion.ts lib/calidad/conciliacion.test.ts
git commit -m "feat(calidad): los desvios del libro contra Odoo, que se calculan y no se guardan"
```

---

## Tarea 5: Odoo deja de crear movimientos

**Archivos:**
- Modificar: `lib/calidad/sincronizar.ts`

**Interfaces:**
- Consume: `desviosContraOdoo` (tarea 4), `movimientoDesdeLaLineaDeOdoo` (`lib/calidad/reconocer.ts`).
- Produce: `controlarContraOdoo(supabase): Promise<Desvios & { leidas: number }>`. **Desaparecen** `sincronizarCarbonillaConOdoo` y `CALIDAD_DESDE`.

- [ ] **Paso 1: Reescribir el archivo**

`sincronizarCarbonillaConOdoo` desaparece y queda `controlarContraOdoo`. El
cuerpo que trae las líneas de Odoo **no cambia** —es el mismo dominio, la misma
ventana de 30 días sobre `create_date`— y lo que se va es todo el tramo que
insertaba.

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarLeer } from "@/lib/odoo/client";
import { hoyEnArgentina, sumarDias } from "@/lib/core/fechas";
import { movimientoDesdeLaLineaDeOdoo, type Catalogos, type LineaDeOdoo } from "./reconocer";
import { traerCarbonilleros, traerMovimientos, traerProductosDeOdoo } from "./consultas";
import {
  desviosContraOdoo,
  type CamionDelLibro,
  type Desvios,
  type LineaDeOdooParaControl,
} from "./conciliacion";

/**
 * El libro contra Odoo: qué camión no tiene orden de compra.
 *
 * **Odoo dejó de crear movimientos el 13/10/2026.** La planilla manda sobre el
 * libro, y esto pasó a ser el único lugar que avisa que un camión entró sin
 * orden de compra — que es plata que después no se puede facturar.
 *
 * LA VENTANA SIGUE SIENDO `create_date` Y NO `date_order`, por la misma razón
 * de siempre: una orden fechada el 05/09 y cargada el 20/09 la ventana por
 * fecha de orden no la ve nunca. Se midió: 1.053 de 1.055 órdenes del año se
 * cargan el mismo día, pero el máximo son 3 y el 16/09 Odoo llevaba once sin
 * cargar.
 *
 * **No inserta ni borra nada.** Devuelve los desvíos y quien llama decide qué
 * mostrar.
 *
 * Spec: docs/superpowers/specs/2026-10-13-calidad-la-planilla-manda-design.md
 */

const DIAS_DE_MARGEN = 30;
const LOTE = 200;

export interface ResumenDelControl extends Desvios {
  /** Cuántas líneas de Odoo se miraron. */
  leidas: number;
}

export async function controlarContraOdoo(
  supabase: SupabaseClient
): Promise<ResumenDelControl> {
  const vacio: ResumenDelControl = {
    leidas: 0,
    sinOrden: [],
    sinCamion: [],
    cantidadDistinta: [],
  };

  const [carbonilleros, productos] = await Promise.all([
    traerCarbonilleros(supabase),
    traerProductosDeOdoo(supabase),
  ]);

  const activos = carbonilleros.filter((c) => c.activo);
  if (activos.length === 0) return vacio;

  const catalogos: Catalogos = {
    carbonilleros: new Map(
      activos.map((c) => [
        c.odoo_partner_id,
        { id: c.id, carbon: c.carbon, proveedorId: c.proveedor_id },
      ])
    ),
    productos: new Map(productos.map((p) => [p.odoo_product_id, p.cuenta])),
  };

  const desde = sumarDias(hoyEnArgentina(), -DIAS_DE_MARGEN);

  const crudas = await buscarLeer<{
    id: number;
    order_id: [number, string];
    product_id: [number, string];
    partner_id: [number, string];
    product_qty: number;
  }>(
    "purchase.order.line",
    [
      ["order_id.state", "=", "purchase"],
      ["order_id.partner_id", "in", activos.map((c) => c.odoo_partner_id)],
      ["create_date", ">=", `${desde} 00:00:00`],
    ],
    ["id", "order_id", "product_id", "partner_id", "product_qty"],
    { limite: 2000 }
  );
  if (crudas.length === 0) return vacio;

  const ordenIds = [...new Set(crudas.map((l) => l.order_id[0]))];
  const ordenes = await buscarLeer<{ id: number; date_order: string }>(
    "purchase.order",
    [["id", "in", ordenIds]],
    ["id", "date_order"],
    { limite: 2000 }
  );
  const fechaDeOrden = new Map(ordenes.map((o) => [o.id, String(o.date_order).slice(0, 10)]));

  // `movimientoDesdeLaLineaDeOdoo` se usa SÓLO para separar los camiones de los
  // fletes. Lo que devuelve ya no se guarda: su `movimiento` se descarta.
  const deOdoo: LineaDeOdooParaControl[] = [];
  for (const l of crudas) {
    const linea: LineaDeOdoo = {
      id: l.id,
      ordenNombre: l.order_id[1],
      fecha: fechaDeOrden.get(l.order_id[0]) ?? "",
      partnerId: l.partner_id[0],
      partnerNombre: l.partner_id[1],
      productoId: l.product_id[0],
      productoNombre: l.product_id[1],
      cantidad: l.product_qty,
    };
    if (!linea.fecha) continue;
    if (movimientoDesdeLaLineaDeOdoo(linea, catalogos).resultado !== "entra") continue;
    deOdoo.push({
      ordenNombre: linea.ordenNombre,
      fecha: linea.fecha,
      partnerId: linea.partnerId,
      partnerNombre: linea.partnerNombre,
      cantidad: linea.cantidad,
    });
  }

  // Los camiones del libro del mismo período. Se compara contra lo que el libro
  // tiene, que ahora sale de la planilla.
  const partnerDelCarbonillero = new Map(activos.map((c) => [c.id, c.odoo_partner_id]));
  const camiones: CamionDelLibro[] = (await traerMovimientos(supabase))
    .filter(
      (m) =>
        m.tipo === "entrada" &&
        m.fecha >= desde &&
        m.carbonillero_id !== null &&
        partnerDelCarbonillero.has(m.carbonillero_id)
    )
    .map((m) => ({
      id: m.id,
      fecha: m.fecha,
      odooPartnerId: partnerDelCarbonillero.get(m.carbonillero_id as string) as number,
      toneladas: Math.abs(Number(m.toneladas)),
    }));

  return { leidas: crudas.length, ...desviosContraOdoo(camiones, deOdoo) };
}
```

**Y borrar `CALIDAD_DESDE` del archivo**, con todo su bloque de comentario.
Existía para que el cron no pisara lo importado, y `sheets_fila` lo reemplaza.
Una variable de entorno que ya no defiende nada es una trampa para el próximo
que la lea. `LOTE` también se va: ya no hay `.in()` contra Supabase acá.

- [ ] **Paso 2: Verificar y commitear**

```bash
npx tsc --noEmit
git add lib/calidad/sincronizar.ts
git commit -m "feat(calidad): Odoo pasa de fuente a control y deja de crear movimientos"
```

---

## Tarea 6: El cron y el botón

**Archivos:**
- Modificar: `app/api/cron/calidad-sync/route.ts`
- Modificar: `app/api/calidad/sincronizar/route.ts`

- [ ] **Paso 1: Las dos rutas hacen lo mismo, en este orden**

1. `leerLaPlanilla(admin)` — **primero**, porque es lo que mueve el stock.
2. `controlarContraOdoo(admin)` — después, para contar los desvíos sobre el libro ya actualizado.
3. `registrarSincronizacion({ modulo: "calidad", recurso: "carbonilla-planilla", ok, filas: resumen.nuevos })`.
4. Una segunda marca con `recurso: "carbonilla-odoo"` y `filas: desvios.sinOrden.length`, que es lo que la tarjeta del tablero muestra sin llamar a Odoo.

**Review Focus 4: si `leerLaPlanilla` lanza, la marca va con `ok: false` y el control no corre.** Controlar sobre un libro que quedó a medias daría desvíos inventados. Y se anota igual —también cuando falla—, porque una fecha vieja sin explicación es lo que hace que nadie sepa si está mirando datos al día.

Si Odoo no está configurado, la lectura corre igual y sólo se omite el control: el stock no depende de Odoo.

- [ ] **Paso 2: Verificar y commitear**

```bash
npx tsc --noEmit
git add app/api/cron/calidad-sync/route.ts app/api/calidad/sincronizar/route.ts
git commit -m "feat(calidad): el cron lee la planilla y despues controla contra Odoo"
```

---

## Tarea 7: La recepción de Despacho exporta

**Archivos:**
- Modificar: `lib/calidad/desdeLaRecepcion.ts`

- [ ] **Paso 1: Exportar en el mismo paso**

Hoy `anotarLaRecepcionEnElStock` inserta el movimiento y termina. Con la planilla mandando, ese camión **vuelve a entrar** en cuanto alguien lo anote allá.

Después del `upsert`, recuperar el `id` del movimiento y llamar a `exportarMovimiento(admin, id)`, que escribe la fila y guarda `sheets_fila`. Con eso la lectura la ve ocupada y no la duplica.

Borrar además el `import { CALIDAD_DESDE }` y la guarda `if (d.fecha < CALIDAD_DESDE) return` : ya no existe esa variable, y una recepción con fecha vieja ahora se resuelve sola por `sheets_fila`.

Si la exportación falla, **la recepción se cierra igual** —hay un camión afuera— y el aviso sale por el mismo `juntarAvisos` que ya existe. El riesgo queda escrito: ese movimiento sin fila puede duplicarse en la próxima lectura, y por eso el aviso tiene que decirlo con todas las letras.

- [ ] **Paso 2: Verificar y commitear**

```bash
npx tsc --noEmit
npm test
git add lib/calidad/desdeLaRecepcion.ts
git commit -m "feat(calidad): la recepcion exporta a la planilla, o el camion entra dos veces"
```

---

## Tarea 8: Las pantallas

**Archivos:**
- Modificar: `app/(app)/calidad/carbonilla/StockClient.tsx`
- Modificar: `app/(app)/calidad/carbonilla/page.tsx`
- Crear: `app/(app)/calidad/conciliacion/page.tsx`
- Crear: `app/(app)/calidad/conciliacion/ConciliacionClient.tsx`
- Modificar: `lib/core/nav.ts`

- [ ] **Paso 1: La bandeja cambia de forma en el stock**

En `StockClient.tsx`, la sección de la bandeja pasa de hablar de líneas de Odoo a hablar de **filas de la planilla**: por cada una, el número de fila, la fecha, el código y el motivo. Los dos enlaces de abajo ya no van a *Productos* —eso era de Odoo— sino a la planilla y a *Carbonilleros*, que es donde se declara un código nuevo.

El botón **Sincronizar ahora** cambia el texto del resumen: ahora dice cuántos movimientos trajo de la planilla y cuántos camiones quedaron sin orden en Odoo.

- [ ] **Paso 2: La pantalla de conciliación**

Server Component: sesión, `nivelCalidadDe`, y `controlarContraOdoo(supabase)`. El cliente dibuja tres secciones, **la primera arriba y en rojo**:

1. **Camiones sin orden de compra** — fecha, carbonillero, toneladas. *"No se les puede facturar."*
2. Órdenes de Odoo sin camión en el libro.
3. Cantidades distintas — las dos, lado a lado.

Si Odoo no contesta, la pantalla lo dice con **lo que dijo Odoo sin traducir** en vez de mostrar tres listas vacías, que se verían igual que "está todo bien".

- [ ] **Paso 3: El menú**

En `lib/core/nav.ts`, dentro del subgrupo **Carbonilla**, sumar `{ label: "Conciliación", href: "/calidad/conciliacion", modulo: "calidad" }` después de *Movimientos*. **Mirá el archivo antes de tocarlo**: el grupo lo comparte con Envases y Ensayos y puede haber cambiado.

- [ ] **Paso 4: Verificar y commitear**

```bash
npx tsc --noEmit
npm run build
git add "app/(app)/calidad/carbonilla/StockClient.tsx" "app/(app)/calidad/carbonilla/page.tsx" "app/(app)/calidad/conciliacion/page.tsx" "app/(app)/calidad/conciliacion/ConciliacionClient.tsx" lib/core/nav.ts
git commit -m "feat(calidad): la bandeja es de la planilla y la conciliacion tiene pantalla"
```

---

## Tarea 9: La primera corrida, la documentación y el cierre

**Archivos:**
- Modificar: `docs/CALIDAD.md`
- Modificar: `CLAUDE.md`
- Modificar: `docs/VARIABLES-VERCEL.md`

- [ ] **Paso 1: Correr la lectura contra la base y mirar el resultado**

Con la migración ya aplicada, apretar **Sincronizar ahora** (o correr `leerLaPlanilla` desde un script del scratchpad). Esperado, medido el 13/10/2026:

- la planilla tiene **42 entradas y 28 días de consumo** desde el 16/09 que el libro no tiene;
- el saldo pasa de **204,24 / 55,647** a algo muy cerca de **61,88 / 0,227**, que es lo que mostraba la planilla;
- la bandeja queda en **0**.

Si el saldo no se acerca a eso, **parar y mirar por qué antes de seguir**. La diferencia esperable son decenas de kilos por el `TOTAL` de la planilla, que no cierra contra sus propias columnas por tipo.

- [ ] **Paso 2: La documentación**

En `docs/CALIDAD.md`, dar vuelta la sección de la dirección: la planilla manda, `sheets_fila` es lo que evita el lazo, Odoo controla. Sacar `CALIDAD_DESDE` de "lo que falta de una persona" y de `docs/VARIABLES-VERCEL.md`.

En `CLAUDE.md`, en el párrafo de Calidad: carbonilla pasa al lado de Envases —manda la planilla— y deja de ser la excepción. Agregar el porqué en una línea: **el diseño anterior necesitaba que alguien cambiara de costumbre, y hasta que eso pasara el número estaba mal sin avisar**.

- [ ] **Paso 3: Las cuatro verificaciones**

```bash
npm test
npx tsc --noEmit
npm run build
node scripts/revisar-arbol-commiteado.mjs
```

El `build` **no** se corre con `npm run dev` levantado.

- [ ] **Paso 4: Commitear, pushear y decir lo que falta de una persona**

```bash
git add docs/CALIDAD.md CLAUDE.md docs/VARIABLES-VERCEL.md
git commit -m "docs(calidad): la planilla manda, y por que se dio vuelta"
git push
```

Y decirle al usuario, textual:

1. **Borrar `CALIDAD_DESDE` de Vercel.**
2. **Los 11 camiones del 02 al 10/10 en Odoo** — el stock ya los tiene desde la planilla, pero sin orden de compra no se les puede facturar. La pantalla de conciliación los lista.
3. **El conteo físico**, que sigue pendiente desde septiembre: el saldo arranca de un número heredado de la planilla, no de uno medido.
