# Seguimiento de la compra (fase 1) — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un RI marcado `PEDIDO` tenga dónde registrar su recepción en el SdG, pase a `RECIBIDO`, y que eso se escriba solo en el libro SEGUIMIENTO DE COMPRA.

**Architecture:** Siete columnas nuevas en `compras_requerimientos` (el seguimiento es 1:1 con el RI). La lógica que importa —armar la fila de la planilla y calcular el dato duro que se muestra al lado del juicio— sale a funciones puras en `lib/compras/seguimiento.ts`, que son las que se testean. El I/O vive en `lib/compras/seguimientoSheets.ts` y escribe **sólo** la pestaña `COMPRAS CON RI`; las pestañas por área recalculan su `FILTER` solas.

**Tech Stack:** Next.js 16 (App Router), Supabase (PostgREST), Google Sheets API v4, vitest.

**Diseño:** [docs/superpowers/specs/2026-09-15-compras-seguimiento-design.md](../specs/2026-09-15-compras-seguimiento-design.md). Leerlo antes de empezar: las tres reglas duras del exportador no se deducen del código.

---

## Antes de tocar nada

Este repo suele tener **otra sesión trabajando en el mismo árbol** — al escribir este plan había una agregando `equipo_id` a `compras_requerimientos` en la misma tarde. Dos consecuencias que valen para cada tarea:

- **Nunca `git add -A`.** Agregar por nombre, y commitear pasando las rutas (`git commit ruta1 ruta2 -m …`): `git commit` sin rutas se lleva el índice entero.
- Si `tsc` o los tests fallan en archivos que no tocaste, mirá `git status` antes de arreglarlos.

## Estructura de archivos

| Archivo | De qué se ocupa |
|---|---|
| `supabase/migrations/<marca>_compras_seguimiento_de_la_compra.sql` | Las siete columnas |
| `lib/compras/types.ts` | El tipo `Cumplio` y los campos nuevos |
| `lib/compras/seguimiento.ts` | **Puro.** Etiquetas, la fila de 13 celdas, el dato duro, el parseo del histórico |
| `lib/compras/filaDeSeguimiento.test.ts` | Tests de la fila |
| `lib/compras/comoLeLlego.test.ts` | Tests del dato duro |
| `lib/compras/filaDelHistorico.test.ts` | Tests del parseo, con los casos sucios medidos |
| `lib/compras/seguimientoSheets.ts` | **I/O.** Busca la fila libre y escribe el master |
| `app/api/compras/requerimientos/[id]/route.ts` | Acepta los campos nuevos y exporta |
| `app/(app)/compras/seguimiento/page.tsx` | Server component: trae las dos listas |
| `app/(app)/compras/seguimiento/SeguimientoClient.tsx` | La pantalla |
| `app/(app)/compras/seguimiento/FormularioRecepcion.tsx` | El formulario, que usan la pantalla y la ficha |
| `app/(app)/compras/requerimientos/[id]/RequerimientoDetalle.tsx` | El mismo formulario en la ficha del RI |
| `lib/core/nav.ts` | La entrada del menú |
| `app/api/cron/compras-sync/route.ts` | Suma el reintento del seguimiento |
| `scripts/importar-seguimiento.mts` | El histórico, una vez |

---

## Task 1: La migración

**Files:**
- Create: `supabase/migrations/<marca>_compras_seguimiento_de_la_compra.sql`

- [ ] **Step 1: Crear el archivo con marca de tiempo**

Nunca a mano: el nombre lleva catorce dígitos y dos sesiones toman el mismo número si se usa un contador.

```bash
npm run migracion "compras seguimiento de la compra"
```

- [ ] **Step 2: Escribir la migración**

Va todo en un archivo: son siete `ADD COLUMN` sobre la misma tabla y ninguno es un valor de enum nuevo (ésos sí viajan solos, `55P04`).

```sql
-- ============================================================
-- Seguimiento de la compra: la recepción
-- ============================================================
-- Un RI que llega a PEDIDO se quedaba ahí para siempre: hoy hay 1.787 en ese
-- estado y ninguno llegó nunca a RECIBIDO, porque la recepción vivía sólo en
-- el libro SEGUIMIENTO DE COMPRA, cargado a mano.
--
-- `fecha_pedido` y `fecha_recepcion` NO se agregan: ya existían y estaban
-- vacías. El esquema ya anticipaba esto.
--
-- Por qué texto con CHECK y no un enum: los valores son de la planilla
-- ("Si" / "Más o menos" / "No"), no del dominio, y agregar un valor a un enum
-- en este repo ya mordió dos veces. Un CHECK se cambia con un ALTER normal.
--
-- Por qué `seguimiento_pendiente` aparte de `sheets_pendiente`: son dos libros
-- distintos. Mezclados no hay forma de saber a cuál de los dos hay que ir.

alter table compras_requerimientos
  -- "Cant Pedida" de la planilla. Vacía significa "se compró lo que pedía el
  -- RI": coincide en el 99% de las 1.680 filas medidas, y las 25 que no son
  -- reales (el RI 250 pidió 100 y se compraron 95).
  add column if not exists cantidad_comprada numeric,
  add column if not exists cantidad_recibida numeric,
  -- Cuándo dijo Compras que iba a llegar. No confundir con `fecha_necesidad`,
  -- que es cuándo lo necesita quien pidió.
  add column if not exists fecha_estimada_recepcion date,
  add column if not exists cumplio_compras text
    check (cumplio_compras in ('SI', 'MAS_O_MENOS', 'NO')),
  add column if not exists cumplio_proveedor text
    check (cumplio_proveedor in ('SI', 'MAS_O_MENOS', 'NO')),
  -- En qué fila de `COMPRAS CON RI` quedó este RI. Sin esto habría que buscar
  -- la fila por la columna A en cada escritura, que son 1.759 filas.
  add column if not exists seguimiento_fila integer,
  add column if not exists seguimiento_pendiente text;

comment on column compras_requerimientos.seguimiento_fila is
  'Fila del master de SEGUIMIENTO DE COMPRA. Se escribe esa fila y nunca se inserta ni se ordena: las columnas de aplicación de cada pestaña por área viven al lado de un FILTER y son posicionales.';
```

- [ ] **Step 3: Verificar que no rompa nada todavía**

```bash
npx tsc --noEmit
```
Esperado: sin salida. La migración es SQL, no cambia tipos.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/<marca>_compras_seguimiento_de_la_compra.sql
git commit supabase/migrations/<marca>_compras_seguimiento_de_la_compra.sql -m "feat(compras): columnas para el seguimiento de la compra"
```

- [ ] **Step 5: PARAR y pedir que la corran**

**Un agente no puede correr DDL.** Las migraciones las aplica una persona a mano en el editor SQL de Supabase. Decir explícitamente:

> "La migración está escrita en `supabase/migrations/<archivo>`. Hay que correrla en el editor SQL de Supabase antes de seguir: todo lo que viene guarda en esas columnas."

Y esperar. No seguir con la Task 3 en adelante hasta que confirmen.

---

## Task 2: Tipos

**Files:**
- Modify: `lib/compras/types.ts`

- [ ] **Step 1: Agregar los campos a la interfaz del requerimiento**

Buscar la interfaz que ya tiene `oc_numero`, `fecha_pedido` y `fecha_recepcion` (cerca de la línea 117) y agregar debajo:

```ts
  /** Lo que Compras efectivamente compró. Vacío = lo que pedía el RI. */
  cantidad_comprada: number | null;
  cantidad_recibida: number | null;
  /** Cuándo dijo Compras que llegaba. No es `fecha_necesidad`. */
  fecha_estimada_recepcion: string | null;
  cumplio_compras: Cumplio | null;
  cumplio_proveedor: Cumplio | null;
  seguimiento_fila: number | null;
  seguimiento_pendiente: string | null;
```

Y arriba del todo, junto a los otros tipos de estado:

```ts
/** Los tres valores del juicio, tal como los ofrece la planilla. */
export type Cumplio = "SI" | "MAS_O_MENOS" | "NO";
```

- [ ] **Step 2: Verificar**

```bash
npx tsc --noEmit
```
Esperado: sin salida.

- [ ] **Step 3: Commit**

```bash
git commit lib/compras/types.ts -m "feat(compras): tipos del seguimiento de la compra"
```

---

## Task 3: `filaDeSeguimiento()` — las 13 celdas del master

La fila que se escribe en `COMPRAS CON RI`. Es pura a propósito: es donde está la regla de la columna K, que es la que muerde.

**Files:**
- Create: `lib/compras/seguimiento.ts`
- Test: `lib/compras/filaDeSeguimiento.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect } from "vitest";
import { filaDeSeguimiento, type DatosDeSeguimiento } from "./seguimiento";

const BASE: DatosDeSeguimiento = {
  nro_ri: 1952,
  codigo: null,
  area: "Mantenimiento",
  descripcion: "Cable tipo TPR 3 x 4 mm2",
  proveedor: "SINGLA",
  empresa: null,
  paga_ambas: true,
  cantidad: 100,
  cantidad_comprada: null,
  cantidad_recibida: null,
  fecha_estimada_recepcion: null,
  fecha_recepcion: null,
  cumplio_compras: null,
  cumplio_proveedor: null,
};

describe("filaDeSeguimiento", () => {
  /**
   * LA REGLA QUE MUERDE. Un Apps Script de la planilla barre el master
   * buscando filas con fecha de recepción y sin MAIL_ENVIADO para avisarle al
   * área. Si al corregir una recepción se pisara esa celda con vacío, el área
   * recibiría el aviso de nuevo. `null` significa "no escribir esta celda".
   */
  it("nunca escribe MAIL_ENVIADO", () => {
    const fila = filaDeSeguimiento({ ...BASE, fecha_recepcion: "2026-09-15" });
    expect(fila[10]).toBeNull();
  });

  it("la cantidad comprada cae en la del RI cuando no se cargó otra", () => {
    expect(filaDeSeguimiento(BASE)[6]).toBe("100");
    expect(filaDeSeguimiento({ ...BASE, cantidad_comprada: 95 })[6]).toBe("95");
  });

  /**
   * El cero es un valor, no una ausencia: `??` y no `||`. Sin este test,
   * cambiar uno por el otro deja la suite en verde y escribe la cantidad del
   * pedido donde tenía que ir un cero.
   */
  it("una cantidad comprada de cero es cero, y no la del RI", () => {
    expect(filaDeSeguimiento({ ...BASE, cantidad_comprada: 0 })[6]).toBe("0");
  });

  /**
   * Las fechas salen como SERIAL y no como texto.
   *
   * Es la decisión que ya tomó `lib/core/fechaDeSheets.ts` y el motivo está
   * escrito ahí: un "15/9/2026" lo interpreta la planilla según su locale, y
   * leer d/m al revés ya dio vuelta 885 fechas en Compras. El libro es `es_AR`
   * hoy y puede no serlo mañana. Un número no se interpreta.
   */
  it("las fechas salen como serial de Sheets", () => {
    const fila = filaDeSeguimiento({ ...BASE, fecha_recepcion: "2026-09-15" });
    expect(fila[9]).toBe("46280");
  });

  /**
   * Una fecha imposible se descarta, no se corrige: `serialDelDia` devuelve
   * null para el 30 de febrero en vez de rodarlo al 2 de marzo. Acá eso es una
   * celda vacía, que se nota, y no una fecha plausible corrida tres días.
   */
  it("una fecha imposible deja la celda vacía", () => {
    const fila = filaDeSeguimiento({ ...BASE, fecha_recepcion: "2026-02-30" });
    expect(fila[9]).toBe("");
  });

  it("usa las etiquetas de la planilla para el juicio", () => {
    const fila = filaDeSeguimiento({
      ...BASE,
      cumplio_compras: "MAS_O_MENOS",
      cumplio_proveedor: "SI",
    });
    expect(fila[11]).toBe("Más o menos");
    expect(fila[12]).toBe("Si");   // sin tilde: es como está en la planilla
  });

  it("'Ambas' se expresa aunque no haya empresa", () => {
    expect(filaDeSeguimiento(BASE)[5]).toBe("Ambas");
    expect(filaDeSeguimiento({ ...BASE, paga_ambas: false })[5]).toBe("");
  });

  /** Trece columnas, A a M. Una de más o de menos corre todo el resto. */
  it("son trece celdas", () => {
    expect(filaDeSeguimiento(BASE)).toHaveLength(13);
  });
});
```

- [ ] **Step 2: Correr el test y ver que falla**

```bash
npx vitest run lib/compras/filaDeSeguimiento.test.ts
```
Esperado: FAIL, `Cannot find module './seguimiento'`.

- [ ] **Step 3: Escribir la implementación**

`lib/compras/seguimiento.ts`:

```ts
/**
 * Seguimiento de la compra: lo puro.
 *
 * Acá vive lo que se testea —la fila que se escribe en el master de
 * SEGUIMIENTO DE COMPRA y el dato duro que se muestra al lado del juicio—.
 * El I/O está en `seguimientoSheets.ts`.
 */

import { serialDelDia } from "@/lib/core/fechaDeSheets";
import { empresaParaPlanilla } from "@/lib/compras/sheets";
import type { Cumplio } from "@/lib/compras/types";

/** Cómo se escribe cada juicio en la planilla. "Si" va sin tilde: es así allá. */
export const ETIQUETA_CUMPLIO: Record<Cumplio, string> = {
  SI: "Si",
  MAS_O_MENOS: "Más o menos",
  NO: "No",
};

/** Lo que hace falta saber de un RI para armar su fila. */
export interface DatosDeSeguimiento {
  nro_ri: number;
  codigo: string | null;
  area: string | null;
  descripcion: string | null;
  proveedor: string | null;
  empresa: string | null;
  paga_ambas: boolean;
  cantidad: number | null;
  cantidad_comprada: number | null;
  cantidad_recibida: number | null;
  fecha_estimada_recepcion: string | null;
  fecha_recepcion: string | null;
  cumplio_compras: Cumplio | null;
  cumplio_proveedor: Cumplio | null;
}

const texto = (n: number | null) => (n === null || n === undefined ? "" : String(n));

/**
 * La fecha como serial, que es como la escribe todo el sistema.
 *
 * `serialDelDia` devuelve null para una fecha que no existe —el 30 de febrero
 * no se rueda al 2 de marzo— y acá eso queda en celda vacía: una celda vacía
 * se ve, una fecha corrida tres días no.
 */
const fecha = (iso: string | null) => {
  const serial = iso ? serialDelDia(iso) : null;
  return serial === null ? "" : String(serial);
};

/**
 * Las trece celdas de una fila de `COMPRAS CON RI`, en orden A..M.
 *
 * `null` en una posición significa **no escribir esa celda**, y hoy le pasa a
 * una sola: `MAIL_ENVIADO`. Un Apps Script de la planilla barre el master
 * buscando "fecha de recepción sin mail enviado" para avisarle al área, y
 * estampa el "SI". Si al reescribir una fila pisáramos esa celda con vacío, el
 * área recibiría el aviso de nuevo. La planilla manda sobre esa columna, igual
 * que sobre la celda LINK de la comparativa en el otro libro.
 *
 * El SdG no puede mandar ese mail en su lugar: no hay transporte de correo en
 * el proyecto —Remises usa web push— ni dirección de mail por área en la base.
 */
export function filaDeSeguimiento(r: DatosDeSeguimiento): (string | null)[] {
  return [
    String(r.nro_ri),                                    // A  NºRI
    r.codigo ?? "",                                      // B  CODIGO
    r.area ?? "",                                        // C  ÁREA
    r.descripcion ?? "",                                 // D  Descripción
    r.proveedor ?? "",                                   // E  Proveedor
    empresaParaPlanilla(r.empresa, r.paga_ambas),        // F  ¿Quién compro?
    texto(r.cantidad_comprada ?? r.cantidad),            // G  Cant Pedida
    texto(r.cantidad_recibida),                          // H  Cant Recibida
    fecha(r.fecha_estimada_recepcion),                   // I  Fecha estimada
    fecha(r.fecha_recepcion),                            // J  Fecha de recepción
    null,                                                // K  MAIL_ENVIADO ← nunca
    r.cumplio_compras ? ETIQUETA_CUMPLIO[r.cumplio_compras] : "",     // L
    r.cumplio_proveedor ? ETIQUETA_CUMPLIO[r.cumplio_proveedor] : "", // M
  ];
}
```

- [ ] **Step 4: Correr el test y ver que pasa**

```bash
npx vitest run lib/compras/filaDeSeguimiento.test.ts
```
Esperado: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/compras/seguimiento.ts lib/compras/filaDeSeguimiento.test.ts
git commit lib/compras/seguimiento.ts lib/compras/filaDeSeguimiento.test.ts -m "feat(compras): la fila del master de seguimiento, con la columna del mail intocada"
```

---

## Task 4: `comoLeLlego()` — el dato duro al lado del juicio

`Cumplió COMPRAS?` y `Cumplió PROV?` se cargan a mano: **no son un cálculo**. De los "Sí" del primero, 295 sobre 1.538 habían llegado tarde. Lo que hace esta función es poner el número al lado para que la persona decida mirándolo.

**Files:**
- Modify: `lib/compras/seguimiento.ts`
- Test: `lib/compras/comoLeLlego.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect } from "vitest";
import { comoLeLlego } from "./seguimiento";

describe("comoLeLlego", () => {
  it("dice cuántos días tarde llegó", () => {
    const r = comoLeLlego({
      fecha_estimada_recepcion: "2026-09-06",
      fecha_recepcion: "2026-09-15",
      cantidad: 10, cantidad_comprada: null, cantidad_recibida: 10,
    });
    expect(r.demora).toBe("llegó 9 días tarde");
  });

  it("en o antes de la estimada es a tiempo", () => {
    const r = comoLeLlego({
      fecha_estimada_recepcion: "2026-09-15",
      fecha_recepcion: "2026-09-15",
      cantidad: 1, cantidad_comprada: null, cantidad_recibida: 1,
    });
    expect(r.demora).toBe("llegó a tiempo");
  });

  it("un solo día se dice en singular", () => {
    const r = comoLeLlego({
      fecha_estimada_recepcion: "2026-09-14",
      fecha_recepcion: "2026-09-15",
      cantidad: 1, cantidad_comprada: null, cantidad_recibida: 1,
    });
    expect(r.demora).toBe("llegó 1 día tarde");
  });

  it("sin alguna de las dos fechas no inventa nada", () => {
    expect(comoLeLlego({
      fecha_estimada_recepcion: null, fecha_recepcion: "2026-09-15",
      cantidad: 1, cantidad_comprada: null, cantidad_recibida: 1,
    }).demora).toBeNull();
    expect(comoLeLlego({
      fecha_estimada_recepcion: "2026-09-15", fecha_recepcion: null,
      cantidad: 1, cantidad_comprada: null, cantidad_recibida: 1,
    }).demora).toBeNull();
  });

  it("dice cuánto recibió de cuánto", () => {
    const r = comoLeLlego({
      fecha_estimada_recepcion: null, fecha_recepcion: null,
      cantidad: 1000, cantidad_comprada: null, cantidad_recibida: 500,
    });
    expect(r.cantidad).toBe("recibió 500 de 1000");
  });

  it("compara contra lo comprado y no contra lo pedido en el RI", () => {
    const r = comoLeLlego({
      fecha_estimada_recepcion: null, fecha_recepcion: null,
      cantidad: 100, cantidad_comprada: 95, cantidad_recibida: 95,
    });
    expect(r.cantidad).toBe("recibió todo lo comprado");
  });

  /** Pasa de verdad: el RI 219 recibió 550 de 500. */
  it("recibir de más no se disfraza de completo", () => {
    const r = comoLeLlego({
      fecha_estimada_recepcion: null, fecha_recepcion: null,
      cantidad: 500, cantidad_comprada: null, cantidad_recibida: 550,
    });
    expect(r.cantidad).toBe("recibió 550 de 500: 50 de más");
  });

  it("sin cantidad cargada no dice nada", () => {
    const r = comoLeLlego({
      fecha_estimada_recepcion: null, fecha_recepcion: null,
      cantidad: 500, cantidad_comprada: null, cantidad_recibida: null,
    });
    expect(r.cantidad).toBeNull();
  });

  /**
   * Una fecha que no se puede leer no produce un número: produce nada. Con un
   * `" "` esto devolvía "llegó 46310 días tarde", que es el peor error posible
   * acá —un dato inventado que se lee como cierto— al lado de un juicio que
   * decide una persona.
   */
  it("una fecha ilegible no inventa una demora", () => {
    const base = { cantidad: 1, cantidad_comprada: null, cantidad_recibida: 1 };
    expect(comoLeLlego({ ...base, fecha_estimada_recepcion: " ", fecha_recepcion: "2026-09-15" }).demora).toBeNull();
    expect(comoLeLlego({ ...base, fecha_estimada_recepcion: "31/12/2026", fecha_recepcion: "2026-09-15" }).demora).toBeNull();
    expect(comoLeLlego({ ...base, fecha_estimada_recepcion: "2026-02-30", fecha_recepcion: "2026-09-15" }).demora).toBeNull();
  });

  /**
   * El cero es un valor, no una ausencia: `??` y no `||`. Con `||`, un cero
   * comprado compararía contra la cantidad del pedido original. El test fija
   * el operador, no la redacción: "todo lo comprado" para 0 de 0 es cierto, y
   * una rama para un caso que no aparece en las 1.757 filas del histórico
   * sería trabajo inventado.
   */
  it("compara contra un cero comprado y no contra lo pedido", () => {
    const r = comoLeLlego({
      fecha_estimada_recepcion: null, fecha_recepcion: null,
      cantidad: 100, cantidad_comprada: 0, cantidad_recibida: 0,
    });
    expect(r.cantidad).toBe("recibió todo lo comprado");
  });
});
```

- [ ] **Step 2: Correr el test y ver que falla**

```bash
npx vitest run lib/compras/comoLeLlego.test.ts
```
Esperado: FAIL, `comoLeLlego is not a function`.

- [ ] **Step 3: Escribir la implementación**

Agregar al final de `lib/compras/seguimiento.ts`:

```ts
/** Lo que la pantalla muestra al lado de cada juicio. `null` = no hay qué decir. */
export interface ComoLlego {
  demora: string | null;
  cantidad: string | null;
}

/**
 * El dato duro, para decidir el juicio mirándolo.
 *
 * NO decide el juicio: `Cumplió COMPRAS?` y `Cumplió PROV?` son de la persona.
 * Se midió sobre las 1.757 filas del histórico y no hay regla: 295 de los "Sí"
 * de Compras habían llegado tarde, y 16 de los "No" del proveedor habían
 * recibido todo. Llegar tarde avisando no es lo mismo que llegar tarde.
 */
export function comoLeLlego(r: {
  fecha_estimada_recepcion: string | null;
  fecha_recepcion: string | null;
  cantidad: number | null;
  cantidad_comprada: number | null;
  cantidad_recibida: number | null;
}): ComoLlego {
  return { demora: laDemora(r), cantidad: laCantidad(r) };
}

function laDemora(r: {
  fecha_estimada_recepcion: string | null;
  fecha_recepcion: string | null;
}): string | null {
  if (!r.fecha_estimada_recepcion || !r.fecha_recepcion) return null;

  // La misma guardia que usa `fecha()` para escribir en la planilla: una fecha
  // que no existe, o que no viene como YYYY-MM-DD, no se corrige ni se estima.
  // Sin esto un `" "` daba "llegó 46310 días tarde" —un número con forma de
  // dato real, al lado de un juicio que decide una persona—, que es peor que
  // no decir nada.
  const estimada = serialDelDia(r.fecha_estimada_recepcion);
  const recibida = serialDelDia(r.fecha_recepcion);
  if (estimada === null || recibida === null) return null;

  // Los seriales ya son días enteros, así que la resta da días y no hay husos
  // de por medio. Restar dos `Date` locales sí los tendría: cruzando el cambio
  // de hora devuelve 8,96 días donde hay 9.
  const dias = recibida - estimada;

  if (dias <= 0) return "llegó a tiempo";
  return `llegó ${dias} ${dias === 1 ? "día" : "días"} tarde`;
}

function laCantidad(r: {
  cantidad: number | null;
  cantidad_comprada: number | null;
  cantidad_recibida: number | null;
}): string | null {
  const recibida = r.cantidad_recibida;
  const esperada = r.cantidad_comprada ?? r.cantidad;
  if (recibida === null || esperada === null) return null;

  if (recibida === esperada) return "recibió todo lo comprado";
  if (recibida > esperada) {
    return `recibió ${recibida} de ${esperada}: ${recibida - esperada} de más`;
  }
  return `recibió ${recibida} de ${esperada}`;
}
```

- [ ] **Step 4: Correr el test y ver que pasa**

```bash
npx vitest run lib/compras/comoLeLlego.test.ts
```
Esperado: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/compras/comoLeLlego.test.ts
git commit lib/compras/seguimiento.ts lib/compras/comoLeLlego.test.ts -m "feat(compras): el dato duro que acompaña al juicio de cumplimiento"
```

---

## Task 5: El exportador

**Files:**
- Modify: `lib/compras/seguimiento.ts`
- Test: `lib/compras/entraEnElSeguimiento.test.ts`
- Create: `lib/compras/seguimientoSheets.ts`

- [ ] **Step 1: La guarda de estado, primero y con test**

El libro es de **compras hechas**. `exportarSeguimiento` se llama desde el PATCH del requerimiento, que es por donde pasan también aprobar, asignar y cargar un presupuesto: sin esta guarda, cada una de esas acciones le crea una fila a un RI que nadie compró. La decisión va en `lib/compras/seguimiento.ts` y no adentro del I/O porque así se puede probar.

```ts
/**
 * Si un requerimiento tiene que estar en el libro de seguimiento.
 *
 * `yaTieneFila` es la excepción y no una concesión: si el RI ya ocupa una fila
 * —porque se compró y después volvió a comparativa— esa fila existe, y dejar de
 * escribirla la congelaría con datos viejos. Se sigue manteniendo al día; lo que
 * no se hace nunca es CREARLA fuera de tiempo.
 */
export function entraEnElSeguimiento(
  estadoCompra: string | null,
  yaTieneFila: boolean
): boolean {
  if (estadoCompra === "PEDIDO" || estadoCompra === "RECIBIDO") return true;
  return yaTieneFila;
}
```

Su test, en `lib/compras/entraEnElSeguimiento.test.ts`, cubre los tres casos: lo comprado entra; ninguno de los otros estados entra (`SIN_INICIAR`, `EN_COMPARATIVA`, `PARA_COMPRAR`, `APROBADO`, `DENEGADO`, `EN_ESPERA`, `null`); y un RI que ya tiene fila se sigue escribiendo aunque haya vuelto atrás.

- [ ] **Step 2: Escribir el exportador entero**

No lleva test: es I/O contra Google. Lo que se puede probar ya está probado en las Tasks 3 y 4.

```ts
/**
 * Exportación al libro SEGUIMIENTO DE COMPRA.
 *
 * Es de **una sola dirección**: el SdG manda y la planilla queda como el lugar
 * donde miran los que no entran al sistema, igual que en Producción. El SdG no
 * la vuelve a leer nunca, salvo la importación del histórico, que corre una vez.
 *
 * Escribe SÓLO la pestaña `COMPRAS CON RI`. Las nueve pestañas por área son
 * `=FILTER('COMPRAS CON RI'!A2:M3151; C2:C3151="<Área>")` y se recalculan
 * solas; además sus columnas A:M están protegidas contra esta cuenta.
 *
 * ── LAS DOS REGLAS QUE NO SE DEDUCEN ──────────────────────
 *
 * 1. NUNCA `values.append`. Debajo de la última fila real (la 1.759) hay 362
 *    filas con `#N/A` hasta la 2.121, y `append` no escribe después de los
 *    datos: escribe después de **todo**. Mandaría la fila a la 2.122. Es el
 *    mismo bug que llevó dos presupuestos del RI 1865 a las filas 1003 y 1004
 *    de una comparativa, con la app diciendo que los había escrito. La fila
 *    libre se busca por la **columna A**.
 *
 * 2. NUNCA insertar en el medio ni ordenar. Las columnas `Se aplicó?` y
 *    `Fecha de Aplicación` de cada pestaña por área viven al lado del `FILTER`
 *    y son posicionales: correr una fila del master hace que cada una pase a
 *    describir el RI de al lado, sin que nada avise.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { leerValores, escribirCeldas } from "@/lib/core/sheets";
import {
  filaDeSeguimiento, entraEnElSeguimiento, type DatosDeSeguimiento,
} from "@/lib/compras/seguimiento";
import type { Cumplio } from "@/lib/compras/types";

const HOJA = "COMPRAS CON RI";

const idPlanilla = () => process.env.GOOGLE_SHEETS_SEGUIMIENTO_ID ?? "";

/** Si la exportación está configurada. Sin la variable no es un error: se omite. */
export const haySeguimiento = () => Boolean(idPlanilla());

/** Lo que no cambia durante una corrida de escrituras. */
export interface CacheDeSeguimiento {
  columnaA?: string[][];
  ultimaTomada?: number;
}

/**
 * Dónde va la fila de este RI, y si hay que estrenarla.
 *
 * Busca **por el número de RI en la columna A** antes de tomar una fila libre,
 * que es lo mismo que hace `filaEnMaster` para el otro libro. Tomar siempre la
 * primera libre traía dos males que no avisan: si el `update` que guarda
 * `seguimiento_fila` falló después de una escritura buena, el intento
 * siguiente escribía una SEGUNDA fila para el mismo RI; y dos RI exportados a
 * la vez calculaban la misma fila y el segundo pisaba al primero sin error.
 *
 * Por la columna A y no por `getLastRow`: debajo de la última fila real hay
 * 362 filas con `#N/A` cuya columna A está vacía, así que la A es la única que
 * dice de verdad si una fila tiene datos.
 */
async function ubicarFila(
  nroRi: number,
  cache?: CacheDeSeguimiento
): Promise<{ fila: number; esNueva: boolean }> {
  const columnaA = cache?.columnaA ?? (await leerValores(idPlanilla(), `${HOJA}!A:A`));
  if (cache) cache.columnaA = columnaA;

  let ultima = 1; // la 1 es el encabezado
  for (let i = 1; i < columnaA.length; i++) {
    const celda = String(columnaA[i]?.[0] ?? "").trim();
    if (celda === "") continue;
    if (Number(celda) === nroRi) return { fila: i + 1, esNueva: false };
    ultima = i + 1;
  }

  // La primera libre. En una corrida con varios pendientes nuevos se avanza en
  // memoria: releer la columna entera por cada uno gasta cuota y ensancha la
  // ventana en que dos se pisan.
  const fila = Math.max(ultima, cache?.ultimaTomada ?? 0) + 1;
  if (cache) cache.ultimaTomada = fila;
  return { fila, esNueva: true };
}

/**
 * Escribe (o reescribe) la fila de este RI.
 *
 * Devuelve el motivo si no se pudo, o null si salió bien. El motivo se guarda
 * con **lo que dijo Google, sin traducir**: un diagnóstico que no se distingue
 * de otro no es un diagnóstico.
 */
export async function exportarSeguimiento(requerimientoId: string): Promise<string | null> {
  if (!haySeguimiento()) return null;

  const admin = createAdminClient();
  const { data: r } = await admin
    .from("compras_requerimientos")
    // `!empresa_id`: `compras_odoo_ordenes` abre un segundo camino hasta `empresas` (PGRST201).
    .select("*, compras_areas(nombre), empresas!empresa_id(nombre), proveedores!proveedor_id(nombre)")
    .eq("id", requerimientoId)
    .single();

  if (!r) return null;

  // Un RI que todavía no se compró no va al libro de seguimiento, y sin esto
  // iba: esta función se llama desde el PATCH del requerimiento, por donde
  // pasan también aprobar, asignar y cargar un presupuesto. La planilla tiene
  // 1.757 filas y todas son compras hechas; sin la guarda se llenaba con los
  // ~1.968 requerimientos del sistema, y el exportador no borra filas.
  if (!entraEnElSeguimiento(r.estado_compra as string | null, r.seguimiento_fila != null)) {
    return null;
  }

  const datos: DatosDeSeguimiento = {
    nro_ri: r.nro_ri as number,
    codigo: r.codigo as string | null,
    area: (r.compras_areas as { nombre: string } | null)?.nombre ?? null,
    descripcion: r.descripcion as string | null,
    proveedor: (r.proveedores as { nombre: string } | null)?.nombre ?? null,
    empresa: (r.empresas as { nombre: string } | null)?.nombre ?? null,
    paga_ambas: r.paga_ambas === true,
    cantidad: r.cantidad as number | null,
    cantidad_comprada: r.cantidad_comprada as number | null,
    cantidad_recibida: r.cantidad_recibida as number | null,
    fecha_estimada_recepcion: r.fecha_estimada_recepcion as string | null,
    fecha_recepcion: r.fecha_recepcion as string | null,
    cumplio_compras: r.cumplio_compras as Cumplio | null,
    cumplio_proveedor: r.cumplio_proveedor as Cumplio | null,
  };

  let fila = r.seguimiento_fila as number | null;
  const esNueva = !fila;

  try {
    if (!fila) fila = await primeraFilaLibre();

    // Las celdas se arman salteando las `null`: hoy es sólo MAIL_ENVIADO, y
    // saltearla es lo que evita que el área reciba el aviso dos veces.
    const celdas = filaDeSeguimiento(datos)
      .map((valor, columna) => ({ pestana: HOJA, columna, fila: fila as number, valor }))
      .filter((c): c is { pestana: string; columna: number; fila: number; valor: string } =>
        c.valor !== null
      );

    await escribirCeldas(idPlanilla(), celdas);

    const cambios: Record<string, unknown> = { seguimiento_pendiente: null };
    if (esNueva) cambios.seguimiento_fila = fila;
    await admin.from("compras_requerimientos").update(cambios).eq("id", requerimientoId);

    return null;
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    console.error(`No se pudo escribir el RI ${r.nro_ri} en SEGUIMIENTO DE COMPRA: ${motivo}`);
    await admin
      .from("compras_requerimientos")
      .update({ seguimiento_pendiente: motivo })
      .eq("id", requerimientoId);
    return motivo;
  }
}

/**
 * Reintenta lo que había quedado sin escribir.
 *
 * Cinco por corrida, como el otro libro: la cuota de Sheets se cuenta por
 * minuto y un 429 anotado como rechazo hace pensar que la planilla no quiso.
 */
export async function reintentarSeguimiento(): Promise<{ intentados: number; resueltos: number }> {
  if (!haySeguimiento()) return { intentados: 0, resueltos: 0 };

  const admin = createAdminClient();
  const { data } = await admin
    .from("compras_requerimientos")
    .select("id")
    .not("seguimiento_pendiente", "is", null)
    .limit(5);

  let resueltos = 0;
  for (const { id } of data ?? []) {
    if ((await exportarSeguimiento(id as string)) === null) resueltos++;
  }
  return { intentados: (data ?? []).length, resueltos };
}
```

- [ ] **Step 3: Verificar que compila**

```bash
npx tsc --noEmit && npx vitest run
```
Esperado: tsc sin salida, tests en verde.

- [ ] **Step 4: Commit**

```bash
git add lib/compras/seguimientoSheets.ts lib/compras/entraEnElSeguimiento.test.ts
git commit lib/compras/seguimientoSheets.ts -m "feat(compras): exportacion al libro de seguimiento, sin append y sin tocar el mail"
```

---

## Task 6: La ruta acepta los campos y exporta

**Files:**
- Modify: `app/api/compras/requerimientos/[id]/route.ts`

- [ ] **Step 1: Sumar los campos al grupo de compra**

En `CAMPOS_COMPRA` (cerca de la línea 39), que ya tiene `fecha_pedido` y `fecha_recepcion`, agregar:

```ts
const CAMPOS_COMPRA = [
  "estado_compra", "comparativa_url", "proveedor_id", "costo_iva",
  "costo_envio", "oc_numero", "fecha_pedido", "fecha_recepcion",
  "compra_asignada_a",
  // Seguimiento de la compra: los decide quien compra, igual que el resto.
  "cantidad_comprada", "cantidad_recibida", "fecha_estimada_recepcion",
  "cumplio_compras", "cumplio_proveedor",
] as const;
```

- [ ] **Step 2: Exportar al seguimiento después de guardar**

Al lado del `exportarRequerimiento(id)` que ya está (cerca de la línea 383), agregar:

```ts
    // Y al libro de seguimiento, que es otro y tiene su propia cola. Va aparte
    // a propósito: un fallo acá no tiene por qué ensuciar el pendiente del
    // otro libro, ni al revés.
    //
    // Toda ruta que toque un campo que se exporta tiene que exportar: cambiar
    // un estado sin escribirlo en la planilla es una divergencia que no avisa.
    try {
      const motivo = await exportarSeguimiento(id);
      if (motivo) {
        avisoSheets = (avisoSheets ? avisoSheets + " " : "") +
          `El seguimiento no se pudo escribir en la planilla: ${motivo}. Se reintenta solo.`;
      }
    } catch (e) {
      console.error(`No se pudo escribir el seguimiento del RI ${id}:`, e);
    }
```

Y el import arriba:

```ts
import { exportarSeguimiento } from "@/lib/compras/seguimientoSheets";
```

- [ ] **Step 3: Verificar**

```bash
npx tsc --noEmit && npx vitest run
```
Esperado: `tsc` sin salida; vitest todo verde.

- [ ] **Step 4: Commit**

```bash
git commit "app/api/compras/requerimientos/[id]/route.ts" -m "feat(compras): la ruta guarda la recepcion y la escribe en el seguimiento"
```

---

## Task 7: El reintento entra en el cron

**Files:**
- Modify: `app/api/cron/compras-sync/route.ts`

- [ ] **Step 1: Sumarlo a la corrida**

```ts
import { reintentarSeguimiento } from "@/lib/compras/seguimientoSheets";
```

Y en el `try`, después del `reintentarPendientes()` que ya está:

```ts
    const reintento = await reintentarPendientes();
    // El libro de seguimiento tiene su propia cola: `seguimiento_pendiente`.
    const seguimiento = await reintentarSeguimiento();
    return NextResponse.json({ ...importado, reintento, seguimiento });
```

- [ ] **Step 2: Verificar**

```bash
npx tsc --noEmit
```
Esperado: sin salida.

- [ ] **Step 3: Commit**

```bash
git commit app/api/cron/compras-sync/route.ts -m "feat(compras): el cron tambien reintenta el seguimiento"
```

---

## Task 8: La pantalla

**Files:**
- Create: `app/(app)/compras/seguimiento/page.tsx`
- Create: `app/(app)/compras/seguimiento/SeguimientoClient.tsx`

- [ ] **Step 1: El server component**

Sigue el patrón de `app/(app)/compras/para-aprobar/page.tsx`. **`traerTodo()` no es opcional**: PostgREST corta en 1000 filas sin avisar, y la lista de recibidos va a pasar las 1.700.

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { permisosComprasActuales } from "@/lib/compras/sesion";
import { traerTodo } from "@/lib/core/paginado";
import SeguimientoClient from "./SeguimientoClient";
import type { RequerimientoConRelaciones } from "@/lib/compras/types";

export default async function SeguimientoPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const { puedeEditar } = await permisosComprasActuales();
  if (!puedeEditar) redirect("/compras");

  // Los dos estados en una sola consulta: son la misma pantalla y traerlos por
  // separado duplica el viaje. `traerTodo` porque los recibidos son ~1.700.
  const requerimientos = await traerTodo<RequerimientoConRelaciones>((desde, hasta) =>
    supabase
      .from("compras_requerimientos")
      // `!empresa_id`: `compras_odoo_ordenes` abre un segundo camino hasta `empresas` (PGRST201).
      .select("*, compras_areas(nombre), empresas!empresa_id(nombre), proveedores!proveedor_id(nombre)")
      .in("estado_compra", ["PEDIDO", "RECIBIDO"])
      .order("fecha_pedido", { ascending: false, nullsFirst: false })
      .range(desde, hasta)
  );

  return <SeguimientoClient requerimientos={requerimientos} />;
}
```

- [ ] **Step 2: El cliente**

Dos listas —**Esperando** (`PEDIDO`, arranca en ~144) y **Recibidos** (`RECIBIDO`)—, filtro por área y por proveedor. Cada fila muestra lo que devuelve `comoLeLlego()`:

```tsx
"use client";

import { useState } from "react";
import { comoLeLlego, ETIQUETA_CUMPLIO } from "@/lib/compras/seguimiento";
import type { RequerimientoConRelaciones, Cumplio } from "@/lib/compras/types";

export default function SeguimientoClient({
  requerimientos,
}: {
  requerimientos: RequerimientoConRelaciones[];
}) {
  const [solapa, setSolapa] = useState<"PEDIDO" | "RECIBIDO">("PEDIDO");
  const visibles = requerimientos.filter((r) => r.estado_compra === solapa);

  return (
    <div>
      <nav>
        <button onClick={() => setSolapa("PEDIDO")}>
          Esperando ({requerimientos.filter((r) => r.estado_compra === "PEDIDO").length})
        </button>
        <button onClick={() => setSolapa("RECIBIDO")}>
          Recibidos ({requerimientos.filter((r) => r.estado_compra === "RECIBIDO").length})
        </button>
      </nav>

      {visibles.map((r) => {
        const dato = comoLeLlego(r);
        return (
          <article key={r.id}>
            <h3>RI {r.nro_ri} — {r.descripcion}</h3>
            {dato.demora && <p>{dato.demora}</p>}
            {dato.cantidad && <p>{dato.cantidad}</p>}
            <p>
              Cumplió Compras:{" "}
              {r.cumplio_compras ? ETIQUETA_CUMPLIO[r.cumplio_compras as Cumplio] : "—"}
            </p>
          </article>
        );
      })}
    </div>
  );
}
```

Las clases y la maqueta salen de `app/(app)/compras/para-aprobar/BandejaClient.tsx`, que es la pantalla más parecida: **copiar de ahí y no inventar un estilo nuevo.**

- [ ] **Step 3: El formulario de recepción**

`app/(app)/compras/seguimiento/FormularioRecepcion.tsx`. Es el único lugar donde se carga una recepción, y lo usan las dos pantallas —la lista y la ficha del RI—, así que vive aparte y no adentro de ninguna.

```tsx
"use client";

import { useState } from "react";
import { comoLeLlego, ETIQUETA_CUMPLIO } from "@/lib/compras/seguimiento";
import type { RequerimientoConRelaciones, Cumplio } from "@/lib/compras/types";

const OPCIONES: Cumplio[] = ["SI", "MAS_O_MENOS", "NO"];

export default function FormularioRecepcion({
  requerimiento,
  alGuardar,
}: {
  requerimiento: RequerimientoConRelaciones;
  alGuardar: () => void;
}) {
  const [campos, setCampos] = useState({
    cantidad_comprada: requerimiento.cantidad_comprada ?? requerimiento.cantidad ?? "",
    cantidad_recibida: requerimiento.cantidad_recibida ?? "",
    fecha_estimada_recepcion: requerimiento.fecha_estimada_recepcion ?? "",
    fecha_recepcion: requerimiento.fecha_recepcion ?? "",
    cumplio_compras: requerimiento.cumplio_compras ?? "",
    cumplio_proveedor: requerimiento.cumplio_proveedor ?? "",
  });
  const [aviso, setAviso] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // El dato duro se recalcula con lo que hay escrito ahora, no con lo guardado:
  // la idea es que la persona vea "llegó 9 días tarde" mientras elige el juicio.
  const dato = comoLeLlego({
    fecha_estimada_recepcion: campos.fecha_estimada_recepcion || null,
    fecha_recepcion: campos.fecha_recepcion || null,
    cantidad: requerimiento.cantidad,
    cantidad_comprada: Number(campos.cantidad_comprada) || null,
    cantidad_recibida: campos.cantidad_recibida === "" ? null : Number(campos.cantidad_recibida),
  });

  async function guardar() {
    setGuardando(true);
    setAviso(null);
    const res = await fetch(`/api/compras/requerimientos/${requerimiento.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...campos,
        cantidad_comprada: campos.cantidad_comprada === "" ? null : Number(campos.cantidad_comprada),
        cantidad_recibida: campos.cantidad_recibida === "" ? null : Number(campos.cantidad_recibida),
        cumplio_compras: campos.cumplio_compras || null,
        cumplio_proveedor: campos.cumplio_proveedor || null,
        fecha_estimada_recepcion: campos.fecha_estimada_recepcion || null,
        fecha_recepcion: campos.fecha_recepcion || null,
        // Con fecha de recepción el RI está recibido. Sin ella sigue esperando.
        ...(campos.fecha_recepcion ? { estado_compra: "RECIBIDO" } : {}),
      }),
    });
    const cuerpo = await res.json();
    setGuardando(false);

    // `aviso_sheets` en snake_case, que es lo que la ruta manda de verdad
    // —ver el final de `app/api/compras/requerimientos/[id]/route.ts`— y lo que
    // ya leen `BandejaClient` y `NuevoRequerimientoModal`. Con la forma
    // camelCase el aviso nunca aparecía.
    //
    // Y con aviso NO se llama a `alGuardar`: en la lista eso cierra la tarjeta,
    // y cerrarla desmonta el cartel antes de que nadie lo lea. El cambio se
    // guardó igual, pero los dos lados quedaron diciendo cosas distintas y eso
    // no se puede tragar.
    if (cuerpo.aviso_sheets) setAviso(cuerpo.aviso_sheets);
    else alGuardar();
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); guardar(); }}>
      <label>Cantidad comprada
        <input type="number" value={campos.cantidad_comprada}
          onChange={(e) => setCampos({ ...campos, cantidad_comprada: e.target.value })} />
      </label>
      <label>Cantidad recibida
        <input type="number" value={campos.cantidad_recibida}
          onChange={(e) => setCampos({ ...campos, cantidad_recibida: e.target.value })} />
      </label>
      <label>Fecha estimada
        <input type="date" value={campos.fecha_estimada_recepcion}
          onChange={(e) => setCampos({ ...campos, fecha_estimada_recepcion: e.target.value })} />
      </label>
      <label>Fecha de recepción
        <input type="date" value={campos.fecha_recepcion}
          onChange={(e) => setCampos({ ...campos, fecha_recepcion: e.target.value })} />
      </label>

      <label>¿Cumplió Compras?
        {dato.demora && <span> — {dato.demora}</span>}
        <select value={campos.cumplio_compras}
          onChange={(e) => setCampos({ ...campos, cumplio_compras: e.target.value as Cumplio })}>
          <option value="">Sin responder</option>
          {OPCIONES.map((o) => <option key={o} value={o}>{ETIQUETA_CUMPLIO[o]}</option>)}
        </select>
      </label>

      <label>¿Cumplió el proveedor?
        {dato.cantidad && <span> — {dato.cantidad}</span>}
        <select value={campos.cumplio_proveedor}
          onChange={(e) => setCampos({ ...campos, cumplio_proveedor: e.target.value as Cumplio })}>
          <option value="">Sin responder</option>
          {OPCIONES.map((o) => <option key={o} value={o}>{ETIQUETA_CUMPLIO[o]}</option>)}
        </select>
      </label>

      {aviso && <p role="alert">{aviso}</p>}
      <button type="submit" disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button>
    </form>
  );
}
```

- [ ] **Step 4: El mismo bloque en la ficha del RI**

En `app/(app)/compras/requerimientos/[id]/RequerimientoDetalle.tsx`, mostrar el formulario cuando el RI ya se compró. Es el mismo componente, no una copia: dos formularios que escriben los mismos campos terminan diciendo cosas distintas.

```tsx
import FormularioRecepcion from "@/app/(app)/compras/seguimiento/FormularioRecepcion";
```

y en el cuerpo, donde termina el bloque de la compra:

```tsx
{(requerimiento.estado_compra === "PEDIDO" || requerimiento.estado_compra === "RECIBIDO") && (
  <section>
    <h2>Recepción</h2>
    <FormularioRecepcion requerimiento={requerimiento} alGuardar={() => router.refresh()} />
  </section>
)}
```

- [ ] **Step 5: Agregar la entrada al menú**

En `lib/core/nav.ts`, en el grupo `Compras` (cerca de la línea 134). Va después de "Requerimientos", que es el orden del circuito: se piden, se aprueban, se compran, se reciben.

```ts
      { label: "Requerimientos", href: "/compras/requerimientos", modulo: "compras" },
      { label: "Seguimiento", href: "/compras/seguimiento", modulo: "compras" },
```

`lib/core/nav-compras.test.ts` prueba este menú: correrlo después.

- [ ] **Step 6: Verificar**

```bash
npx tsc --noEmit && npx vitest run
```
Esperado: `tsc` sin salida; vitest verde, incluidos los de `nav-compras`.

- [ ] **Step 7: Commit**

Los tres archivos nuevos se agregan **por nombre**, y el commit lleva las rutas: sin ellas se lleva el índice entero, que puede tener trabajo a medias de otra sesión.

```bash
git add "app/(app)/compras/seguimiento/page.tsx" "app/(app)/compras/seguimiento/SeguimientoClient.tsx" "app/(app)/compras/seguimiento/FormularioRecepcion.tsx"
git commit "app/(app)/compras/seguimiento/page.tsx" "app/(app)/compras/seguimiento/SeguimientoClient.tsx" "app/(app)/compras/seguimiento/FormularioRecepcion.tsx" "app/(app)/compras/requerimientos/[id]/RequerimientoDetalle.tsx" lib/core/nav.ts -m "feat(compras): pantalla de seguimiento de la compra"
```

---

## Task 9: La importación del histórico

**Files:**
- Modify: `lib/compras/seguimiento.ts`
- Test: `lib/compras/filaDelHistorico.test.ts`
- Create: `scripts/importar-seguimiento.mts`

El parseo va en `lib/` y no adentro del script, por lo mismo que hizo `repartirRegistroDeOT`: metido en el I/O no se puede probar, y es donde están los casos sucios que se midieron.

- [ ] **Step 1: Escribir el test que falla**

`lib/compras/filaDelHistorico.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { filaDelHistorico } from "./seguimiento";

/** Una fila A..M tal como la devuelve la API de Sheets. */
const fila = (...celdas: string[]) => celdas;

describe("filaDelHistorico", () => {
  it("lee una fila completa", () => {
    const r = filaDelHistorico(fila(
      "1952", "", "Mantenimiento", "Cable TPR", "SINGLA", "Ambas",
      "100", "100", "8/9/2026", "15/9/2026", "ENVIADO", "Si", "Si"
    ));
    expect(r).toEqual({
      nro_ri: 1952,
      cantidad_comprada: 100,
      cantidad_recibida: 100,
      fecha_estimada_recepcion: "2026-09-08",
      fecha_recepcion: "2026-09-15",
      cumplio_compras: "SI",
      cumplio_proveedor: "SI",
      sucias: [],
    });
  });

  /** Las 363 filas sin NºRI son restos de fórmula con #N/A. No son compras. */
  it("una fila sin NºRI no es una compra", () => {
    expect(filaDelHistorico(fila("", "", "#N/A", "#N/A"))).toBeNull();
  });

  /** Las fechas de la planilla van en d/m. Al revés dio vuelta 885 fechas. */
  it("lee las fechas en d/m y no en m/d", () => {
    const r = filaDelHistorico(fila(
      "9", "", "Almacén", "x", "y", "Polcecal", "1", "1", "", "3/9/2025", "", "", ""
    ));
    expect(r?.fecha_recepcion).toBe("2025-09-03");
  });

  it("reconoce los tres juicios escritos como están en la planilla", () => {
    const r = filaDelHistorico(fila(
      "9", "", "a", "b", "c", "", "1", "1", "", "", "", "Más o menos", "No"
    ));
    expect(r?.cumplio_compras).toBe("MAS_O_MENOS");
    expect(r?.cumplio_proveedor).toBe("NO");
  });

  /**
   * Hay un "1500x1500" en la columna de cantidad recibida. Queda en null y se
   * informa: enlazar al que se le parece es peor que dejar en null, y un 1500
   * inventado no se nota nunca.
   */
  it("una cantidad que no es un número queda en null y se informa", () => {
    const r = filaDelHistorico(fila(
      "9", "", "a", "b", "c", "", "1", "1500x1500", "", "", "", "", ""
    ));
    expect(r?.cantidad_recibida).toBeNull();
    expect(r?.sucias).toEqual(['cantidad recibida "1500x1500"']);
  });

  it("una celda vacía no es una celda sucia", () => {
    const r = filaDelHistorico(fila("9", "", "a", "b", "c", "", "", "", "", "", "", "", ""));
    expect(r?.cantidad_recibida).toBeNull();
    expect(r?.sucias).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr el test y ver que falla**

```bash
npx vitest run lib/compras/filaDelHistorico.test.ts
```
Esperado: FAIL, `filaDelHistorico is not a function`.

- [ ] **Step 3: Escribir la implementación**

Agregar al final de `lib/compras/seguimiento.ts`:

Sumar `fechaDeSheets` al import que ya existe arriba, que hoy trae sólo `serialDelDia`:

```ts
import { fechaDeSheets, serialDelDia } from "@/lib/core/fechaDeSheets";
```

Y al final del archivo:

```ts
/** Lo que una fila del histórico aporta a su requerimiento. */
export interface DelHistorico {
  nro_ri: number;
  cantidad_comprada: number | null;
  cantidad_recibida: number | null;
  fecha_estimada_recepcion: string | null;
  fecha_recepcion: string | null;
  cumplio_compras: Cumplio | null;
  cumplio_proveedor: Cumplio | null;
  /** Celdas que no se pudieron leer. Quedan en null y se informan. */
  sucias: string[];
}

const DE_LA_PLANILLA: Record<string, Cumplio> = {
  "si": "SI",
  "más o menos": "MAS_O_MENOS",
  "mas o menos": "MAS_O_MENOS",
  "no": "NO",
};

/**
 * Una fila A..M del master del histórico. `null` si no es una compra.
 *
 * Las filas sin NºRI —363 de las 2.120— son restos de una fórmula rota, con
 * `#N/A` en el resto de las columnas. No hay ninguna compra real sin RI: se
 * midió.
 */
export function filaDelHistorico(celdas: string[]): DelHistorico | null {
  const nro_ri = Number(String(celdas[0] ?? "").trim());
  if (!Number.isFinite(nro_ri) || nro_ri === 0) return null;

  const sucias: string[] = [];

  const numero = (v: unknown, comoSeLlama: string): number | null => {
    const t = String(v ?? "").trim();
    if (t === "") return null;
    const n = Number(t.replace(",", "."));
    if (Number.isFinite(n)) return n;
    // No se adivina: se informa y queda vacío.
    sucias.push(`${comoSeLlama} "${t}"`);
    return null;
  };

  const juicio = (v: unknown): Cumplio | null =>
    DE_LA_PLANILLA[String(v ?? "").trim().toLowerCase()] ?? null;

  return {
    nro_ri,
    cantidad_comprada: numero(celdas[6], "cantidad comprada"),
    cantidad_recibida: numero(celdas[7], "cantidad recibida"),
    fecha_estimada_recepcion: fechaDeSheets(celdas[8]),
    fecha_recepcion: fechaDeSheets(celdas[9]),
    cumplio_compras: juicio(celdas[11]),
    cumplio_proveedor: juicio(celdas[12]),
    sucias,
  };
}
```

- [ ] **Step 4: Correr el test y ver que pasa**

```bash
npx vitest run lib/compras/filaDelHistorico.test.ts
```
Esperado: PASS, 6 tests.

Si el primer test falla por la fecha, mirar `fechaDeSheets`: acepta el serial de Excel y el texto d/m, y es la única que debe usarse.

- [ ] **Step 5: Commit**

```bash
git add lib/compras/filaDelHistorico.test.ts
git commit lib/compras/seguimiento.ts lib/compras/filaDelHistorico.test.ts -m "feat(compras): parseo de una fila del historico de seguimiento"
```

- [ ] **Step 6: Escribir el script**

Sigue el patrón de `scripts/importar-despacho.mts`: lee `.env.local` solo, ensayo por defecto y `--escribir` para la corrida real. **Usa `filaDelHistorico`, no una copia**: si el parseo cambia, cambia en los dos lados a la vez.

```ts
// Importa el histórico del libro SEGUIMIENTO DE COMPRA a
// `compras_requerimientos`. Se corre UNA VEZ.
//
// Uso:
//   npx tsx scripts/importar-seguimiento.mts            # ensayo: lee y cuenta
//   npx tsx scripts/importar-seguimiento.mts --escribir # escribe
//
// NO EXPORTA, a propósito. Esas 1.757 filas ya están en la planilla: es de
// donde salen. Reescribirlas no agregaría nada y correría el riesgo de tocar
// la columna MAIL_ENVIADO, que le mandaría el aviso al área de nuevo.
//
// Medido el 15/09/2026 antes de escribir esto: las 1.757 filas cruzan por NºRI
// contra la base sin un solo huérfano, así que no hay nada que adivinar.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { leerValores } from "../lib/core/sheets.ts";
import { filaDelHistorico } from "../lib/compras/seguimiento.ts";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const ESCRIBE = process.argv.includes("--escribir");

const filas = await leerValores(process.env.GOOGLE_SHEETS_SEGUIMIENTO_ID!, "COMPRAS CON RI!A2:M");
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

let listas = 0, sinRi = 0;
const sucias: string[] = [];

for (let i = 0; i < filas.length; i++) {
  const r = filaDelHistorico(filas[i]);
  if (!r) { sinRi++; continue; }

  for (const s of r.sucias) sucias.push(`fila ${i + 2} (RI ${r.nro_ri}): ${s}`);

  const cambios = {
    cantidad_comprada: r.cantidad_comprada,
    cantidad_recibida: r.cantidad_recibida,
    fecha_estimada_recepcion: r.fecha_estimada_recepcion,
    fecha_recepcion: r.fecha_recepcion,
    cumplio_compras: r.cumplio_compras,
    cumplio_proveedor: r.cumplio_proveedor,
    // La fila real de la planilla: la 2 del rango leído es la 2 de la hoja.
    seguimiento_fila: i + 2,
    // Con fecha de recepción, el RI está recibido. Sin ella sigue esperando, y
    // su estado queda como está: los 10 que no están en PEDIDO se importan con
    // el suyo. El seguimiento describe lo que pasó, no corrige el circuito.
    ...(r.fecha_recepcion ? { estado_compra: "RECIBIDO" } : {}),
  };

  if (ESCRIBE) await supabase.from("compras_requerimientos").update(cambios).eq("nro_ri", r.nro_ri);
  listas++;
}

console.log(`filas con RI: ${listas} | restos de fórmula salteados: ${sinRi}`);
console.log(`celdas que no se pudieron leer y quedan en null: ${sucias.length}`);
sucias.slice(0, 20).forEach((s) => console.log("  " + s));
console.log(ESCRIBE ? "ESCRITO" : "ensayo: no se escribió nada. Correr con --escribir");
```

- [ ] **Step 7: Correr el ensayo**

```bash
npx tsx scripts/importar-seguimiento.mts
```
Esperado: `filas con RI: 1757 | restos de fórmula salteados: 363`, y la lista de celdas sucias (debería incluir el `"1500x1500"`).

**Si los números no dan eso, parar**: significa que la planilla cambió desde que se midió y el diseño está apoyado en otra cosa.

- [ ] **Step 8: Correr la importación de verdad**

```bash
npx tsx scripts/importar-seguimiento.mts --escribir
```

- [ ] **Step 9: Comprobar contra la base**

```bash
npx tsx -e "
const r = await fetch(process.env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/compras_requerimientos?select=estado_compra&estado_compra=in.(PEDIDO,RECIBIDO)', { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY, Prefer: 'count=exact' } });
console.log(r.headers.get('content-range'));
"
```
Esperado: unos 1.661 en `RECIBIDO` y unos 144 en `PEDIDO`.

- [ ] **Step 10: Commit**

```bash
git add scripts/importar-seguimiento.mts
git commit scripts/importar-seguimiento.mts -m "feat(compras): importar el historico del libro de seguimiento"
```

---

## Task 10: Documentación y variable de entorno

**Files:**
- Modify: `docs/VARIABLES-VERCEL.md`
- Modify: `docs/COMPRAS-ESTADO.md`

- [ ] **Step 1: La variable**

En `docs/VARIABLES-VERCEL.md`, en la tabla de sincronización de Compras, después de `GOOGLE_SHEETS_COMPRAS_ID`:

```markdown
| `GOOGLE_SHEETS_SEGUIMIENTO_ID` | El libro del seguimiento de la compra | `1TS3JYzTF2M_XTlaqaACphSdSXc5K5rh6b6UsAXBSYx8`. Sin ella no hay exportación, y no es un error: se omite |
```

Y cargarla en Vercel (production, preview y development) y en `.env.local`.

- [ ] **Step 2: El estado del módulo**

En `docs/COMPRAS-ESTADO.md`, en "Lo que hay que saber de la planilla", una sección nueva con:

- que el libro de seguimiento es de **una sola dirección** y el SdG manda;
- que `MAIL_ENVIADO` es de la planilla y por qué (el Apps Script `triggerPedidoRecibidoTiempo` le avisa al área, y pisar esa celda manda el aviso dos veces);
- que **no se usa `append`** y por qué (362 filas de `#N/A` debajo de la última real);
- que ordenar el master desalinea las columnas de aplicación de cada área.

- [ ] **Step 3: Commit**

```bash
git commit docs/VARIABLES-VERCEL.md docs/COMPRAS-ESTADO.md -m "docs(compras): el libro de seguimiento y sus dos trampas"
```

---

## Cierre

- [ ] **Mirar la primera fila que escriba el sistema**

En la planilla, no en la base. Lo que hay que ver:

- que **`Fecha estimada` y `Fecha de recepción` se vean como fecha y no como un número** de cinco dígitos. Se escriben como serial, así que dependen del formato de la celda; las 1.757 filas viejas lo tienen, pero una fila nueva por debajo de la 1.759 puede no tenerlo. Si aparece `46280`, hay que darle formato de fecha a las columnas I y J del rango que sigue;
- que la fila haya caído en la **1.760 y no en la 2.122**. Si cayó abajo de todo, alguien usó `append`;
- que **`MAIL_ENVIADO` de esa fila quedó vacía**, y que al aparecer la fecha de recepción el área recibió un solo aviso.

- [ ] **Correr las cuatro verificaciones**

```bash
npx vitest run
npx tsc --noEmit
npm run build
node scripts/revisar-arbol-commiteado.mjs
```

La última no es opcional y es la que atrapa lo que las otras no pueden: mira **el árbol commiteado**, que es lo que construye Vercel, y en este repo eso no es lo mismo que el disco porque se commitea con rutas explícitas. Un archivo nuevo que quedó staged y nunca se commiteó no viaja, mientras los que lo importan sí. Eso tiró cuatro deploys seguidos el 14/09/2026.

Y **parar `npm run dev` antes del build**: con el dev server levantado, `next build` deja la app en 500.

- [ ] **Pushear**

```bash
git push origin main
```

Si rebota porque otra sesión pusheó, rebasar; y si hay cambios sin commitear que no son tuyos, no hagas `git pull --rebase`.
