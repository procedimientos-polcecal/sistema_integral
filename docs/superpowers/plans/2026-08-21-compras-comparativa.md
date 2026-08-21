# Comparativa de proveedores — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Compras cargue los presupuestos de un requerimiento dentro de la app, y que NICO o MAXI aprueben la compra eligiendo uno, sin abrir Google Sheets.

**Architecture:** La lógica de la comparativa (fórmula del total, mapeo de columnas, regla de la columna A) vive en un módulo puro y testeado (`lib/compras/comparativa.ts`). El acceso a Drive queda en `lib/compras/drive.ts`, sobre el mismo JWT a mano que ya usa la sincronización con el master, extraído a `lib/compras/google.ts`. La UI es un componente propio en la ficha del RI, no una pantalla nueva. La base guarda el total como columna generada.

**Tech Stack:** Next.js 16 (App Router, Server Components), Supabase/Postgres, Google Sheets API v4 + Drive API v3 (fetch directo, sin `googleapis`), vitest.

**Spec:** [docs/superpowers/specs/2026-08-21-compras-comparativa-design.md](../specs/2026-08-21-compras-comparativa-design.md)

**Fuera de alcance (plan aparte):** el importador de las comparativas históricas de la carpeta de Drive. Reusa `lib/compras/drive.ts` y el schema de este plan, así que va después.

**Punto abierto, a trabajar con el usuario:** cómo se muestra la comparativa. Este plan deja una tabla funcional (ordenada por total, el más barato señalado, aviso de precio vencido). El refinamiento visual se hace con alternativas a la vista, después de la Tarea 12.

---

## Estructura de archivos

**Crear:**
| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/026_compras_comparativa.sql` | columnas de la plantilla, total generado, sacar el unique |
| `lib/compras/texto.ts` | `norm()`, la normalización compartida (hoy duplicada dentro de `sheets.ts`) |
| `lib/compras/comparativa.ts` | lógica pura: total, encabezados, regla de la columna A, fila para la planilla |
| `lib/compras/comparativa.test.ts` | tests de lo anterior |
| `lib/compras/google.ts` | token JWT de Google, con scopes |
| `lib/compras/drive.ts` | listar la carpeta, leer una planilla, agregar/vaciar fila, marcar elección |
| `app/api/compras/comparativas/route.ts` | GET: archivos de la carpeta |
| `app/api/compras/requerimientos/[id]/comparativa/route.ts` | POST: adjuntar una planilla y traer sus filas |
| `app/api/compras/requerimientos/[id]/cotizaciones/route.ts` | POST: cargar un presupuesto |
| `app/api/compras/cotizaciones/[id]/route.ts` | PATCH y DELETE de un presupuesto |
| `app/api/compras/cotizaciones/[id]/elegir/route.ts` | POST: elegir = aprobar la compra |
| `app/(app)/compras/requerimientos/[id]/Comparativa.tsx` | la sección completa en la ficha |
| `app/(app)/compras/requerimientos/[id]/PresupuestoForm.tsx` | el formulario de carga |
| `app/(app)/compras/requerimientos/[id]/SelectorComparativa.tsx` | elegir archivo de Drive |

**Modificar:**
| Archivo | Cambio |
|---|---|
| `lib/compras/types.ts` | `Cotizacion` con los campos nuevos; `Requerimiento` con `comparativa_drive_id`/`_nombre` |
| `lib/compras/constants.ts` | `PLAZOS_PAGO`, `DISPONIBILIDADES`, `REQUISITOS.PARA_COMPRAR` |
| `lib/compras/sheets.ts` | usa `google.ts` y `texto.ts`; borra su `obtenerToken` y su `norm` |
| `lib/compras/circuito.test.ts` | fija que aprobar deja el RI en `EN_COMPARATIVA` |
| `app/api/compras/requerimientos/[id]/route.ts` | el salto de estado, el requisito de comparativa, bajar proveedor y costos |
| `app/(app)/compras/requerimientos/[id]/page.tsx` | pasa `esAsignado` y la comparativa |
| `app/(app)/compras/requerimientos/[id]/RequerimientoDetalle.tsx` | saca la tabla de sólo lectura, monta `<Comparativa>` |
| `.env.example`, `docs/VARIABLES-VERCEL.md`, `docs/COMPRAS.md`, `docs/COMPRAS-SINCRONIZACION.md` | la variable nueva y cómo funciona |

---

## Tarea 1: Migración del schema

**Files:**
- Create: `supabase/migrations/026_compras_comparativa.sql`

- [ ] **Step 1: Verificar que la tabla no tiene datos reales**

El plan renombra y reemplaza columnas. Es seguro sólo si la tabla está vacía (nunca hubo pantalla). Verificarlo, no asumirlo:

```bash
node -e "const fs=require('fs');const e=Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]));fetch(e.NEXT_PUBLIC_SUPABASE_URL.replace(/\/rest\/v1\/?$/,'')+'/rest/v1/compras_cotizaciones?select=id',{headers:{apikey:e.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+e.SUPABASE_SERVICE_ROLE_KEY,Prefer:'count=exact'}}).then(r=>r.text()).then(t=>console.log('filas:',t))"
```

Esperado: `filas: []`. Si devuelve filas, **parar** y avisar: hay que migrar los datos en vez de reemplazar columnas.

- [ ] **Step 2: Escribir la migración**

```sql
-- ============================================================
-- SdG — Compras: la comparativa de proveedores
--
-- La tabla se estira hasta la forma real de la planilla
-- "00. COMPARATIVA DE PROVEEDORES GENERICO": marca, unidad de medida,
-- cantidad, descuento e IVA por fila, hasta cuándo vale el precio, plazo de
-- pago, disponibilidad y comentario.
--
-- Dos correcciones sobre lo que había:
--
--   * `plazo_entrega` mezclaba dos datos distintos de la planilla: el plazo de
--     PAGO (columna O, en días) y la DISPONIBILIDAD (columna Q, cuándo llega).
--     Se separan.
--   * el `unique (requerimiento_id, proveedor_id)` prohibía que un proveedor
--     cotice dos marcas del mismo artículo, que es un caso real: la planilla
--     tiene columna MARCA.
--
-- Los renames son limpios porque la tabla nunca tuvo pantalla y está vacía
-- (verificado antes de aplicar).
-- ============================================================

alter table compras_cotizaciones
  add column if not exists marca           text,
  add column if not exists unidad_medida   text,
  add column if not exists cantidad        numeric,
  -- Fracciones, como en la planilla: 0.10 es 10%.
  add column if not exists descuento       numeric(6,4) not null default 0,
  -- A diferencia de prioridad y empresa, el IVA sí lleva default: el 21% es la
  -- alícuota general, un hecho y no una decisión disfrazada de dato. Dejarlo
  -- vacío no significa "sin decidir", significa calcular el total mal.
  add column if not exists iva             numeric(6,4) not null default 0.21,
  add column if not exists precio_hasta    date,
  add column if not exists plazo_pago_dias integer,
  add column if not exists disponibilidad  text,
  add column if not exists comentario      text,
  add column if not exists origen          text not null default 'app',
  -- Qué fila ocupa en la planilla de Drive. Es lo que permite volver sobre esa
  -- misma fila —marcarle la elección, vaciarla— sin duplicarla.
  add column if not exists drive_fila      integer;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'compras_cotizaciones'
      and column_name = 'condiciones'
  ) then
    alter table compras_cotizaciones rename column condiciones to condiciones_pago;
  end if;
end $$;

alter table compras_cotizaciones drop column if exists plazo_entrega;

-- ── El total lo calcula la base ──────────────────────────────
-- La fórmula de la plantilla deja el envío afuera, y eso hace que dos
-- presupuestos no sean comparables cuando uno cobra el flete y el otro no.
-- Confirmado con quienes la usan: es un error, no una decisión.
--
-- Va como columna generada para que la cuenta viva en un solo lugar y no pueda
-- quedar desfasada entre la pantalla, la API y el importador. `cantidad` nula
-- vale 1: es una cotización por monto total, no por unidad.
alter table compras_cotizaciones drop column if exists precio_total;

alter table compras_cotizaciones
  add column precio_total numeric(14,2)
  generated always as (
    round(
      coalesce(precio_unitario, 0)
        * coalesce(cantidad, 1)
        * (1 - coalesce(descuento, 0))
        * (1 + coalesce(iva, 0))
      + coalesce(costo_envio, 0)
    , 2)
  ) stored;

-- ── Un proveedor puede cotizar dos marcas ────────────────────
do $$
declare nombre text;
begin
  select con.conname into nombre
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where rel.relname = 'compras_cotizaciones'
    and nsp.nspname = 'public'
    and con.contype = 'u';

  if nombre is not null then
    execute format('alter table compras_cotizaciones drop constraint %I', nombre);
  end if;
end $$;

-- ── Qué planilla se adjuntó ──────────────────────────────────
alter table compras_requerimientos
  add column if not exists comparativa_drive_id text,
  add column if not exists comparativa_nombre   text;

comment on column compras_requerimientos.comparativa_drive_id is
  'Archivo de la carpeta de comparativas de Drive del que se cargan los presupuestos.';

comment on column compras_cotizaciones.origen is
  'app = cargada en el sistema; drive = leída de la planilla. Al volver a traer se borran las de drive y se dejan las de app.';
```

- [ ] **Step 3: Aplicar la migración**

La aplica el usuario en el SQL Editor de Supabase (proyecto `sqfdqoxyqkaekxlluvpg`), como las 25 anteriores. Pedírselo y esperar confirmación antes de seguir con las tareas que leen columnas nuevas.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/026_compras_comparativa.sql
git commit -m "feat(compras): la comparativa toma la forma real de la planilla"
```

---

## Tarea 2: Normalización compartida

`sheets.ts` tiene un `norm()` privado que `comparativa.ts` necesita igual. Se saca a su propio módulo antes de duplicarlo.

**Files:**
- Create: `lib/compras/texto.ts`
- Modify: `lib/compras/sheets.ts:89-95`

- [ ] **Step 1: Crear el módulo**

```ts
/**
 * Normalización de textos que vienen de la planilla.
 *
 * Los encabezados y los valores llegan con acentos, grados, puntos y espacios
 * de más según quién los escribió. Comparar sin normalizar es la fuente más
 * común de "esa columna no existe" cuando existe.
 */
export const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[°º.]/g, "")
    .replace(/\s+/g, " ");
```

- [ ] **Step 2: Usarlo en sheets.ts**

Borrar la definición local de `norm` (líneas 91-95) y agregar el import arriba, junto a los otros:

```ts
import { norm } from "@/lib/compras/texto";
```

- [ ] **Step 3: Verificar que nada se rompió**

Run: `npm test`
Expected: PASS — los tests de `aprobacion`, `circuito` y `textoAprobacion` siguen verdes.

- [ ] **Step 4: Commit**

```bash
git add lib/compras/texto.ts lib/compras/sheets.ts
git commit -m "refactor(compras): la normalizacion de la planilla queda compartida"
```

---

## Tarea 3: Lógica pura de la comparativa (TDD)

**Files:**
- Create: `lib/compras/comparativa.test.ts`
- Create: `lib/compras/comparativa.ts`

- [ ] **Step 1: Escribir los tests**

```ts
import { describe, it, expect } from "vitest";
import {
  COLUMNAS_COMPARATIVA, mapearEncabezados, filasParaEsteRi,
  totalCotizacion, parsearFila, filaParaPlanilla, DISPONIBILIDADES, PLAZOS_PAGO,
} from "./comparativa";

const ENCABEZADO = [...COLUMNAS_COMPARATIVA];

describe("total de una cotización", () => {
  it("suma el envío, que la fórmula de la planilla dejaba afuera", () => {
    // 100 × 2 = 200, sin descuento, +21% = 242, + 50 de envío = 292
    expect(totalCotizacion({
      precio_unitario: 100, cantidad: 2, descuento: 0, iva: 0.21, costo_envio: 50,
    })).toBe(292);
  });

  it("aplica el descuento antes del IVA", () => {
    // 100 × 1 × 0.9 = 90, +21% = 108.9
    expect(totalCotizacion({
      precio_unitario: 100, cantidad: 1, descuento: 0.1, iva: 0.21, costo_envio: null,
    })).toBe(108.9);
  });

  it("una cantidad vacía vale 1: es una cotización por monto total", () => {
    expect(totalCotizacion({
      precio_unitario: 1000, cantidad: null, descuento: null, iva: 0, costo_envio: null,
    })).toBe(1000);
  });

  it("redondea a dos decimales", () => {
    expect(totalCotizacion({
      precio_unitario: 33.33, cantidad: 3, descuento: 0, iva: 0.21, costo_envio: null,
    })).toBe(120.99);
  });
});

describe("mapeo de encabezados", () => {
  it("encuentra las columnas de la plantilla genérica", () => {
    const r = mapearEncabezados(ENCABEZADO);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.idx.nro_ri).toBe(0);
    expect(r.idx.proveedor).toBe(4);
    expect(r.idx.precio_unitario).toBe(7);
    expect(r.idx.eleccion).toBe(18);
  });

  it("tolera acentos, mayúsculas y espacios de más", () => {
    const raro = ENCABEZADO.map((c) => `  ${c.toLowerCase()}  `);
    expect(mapearEncabezados(raro).ok).toBe(true);
  });

  it("rechaza una planilla con otra estructura y dice qué falta", () => {
    const r = mapearEncabezados(["FECHA", "COSA", "OTRA COSA"]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.faltan).toContain("PROVEEDOR");
    expect(r.faltan).toContain("PRECIO UNITARIO");
  });
});

describe("regla de la columna A", () => {
  const idx = 0;
  const filas = [
    ["", "", "", "", "Proveedor Vacio", "", "", "100"],       // fila 2: libre
    ["1850", "", "", "", "Proveedor Propio", "", "", "200"],  // fila 3: de este RI
    ["999", "", "", "", "Proveedor Ajeno", "", "", "300"],    // fila 4: de otro RI
    ["", "", "", "", "", "", "", ""],                          // fila 5: vacía
  ];

  it("trae las filas vacías y las de este RI, e ignora las de otro", () => {
    const r = filasParaEsteRi(filas, idx, 1850);
    expect(r.propias.map((p) => p.numeroFila)).toEqual([2, 3]);
    expect(r.ajenas).toBe(1);
  });

  it("no cuenta las filas vacías como ajenas ni como propias", () => {
    const r = filasParaEsteRi(filas, idx, 1850);
    expect(r.propias).toHaveLength(2);
    expect(r.ajenas).toBe(1);
  });
});

describe("parsear una fila de la planilla", () => {
  it("lee los porcentajes como fracción y las fechas como ISO", () => {
    const r = mapearEncabezados(ENCABEZADO);
    if (!r.ok) throw new Error("encabezado inválido");
    const fila = [
      "1850", "1/8/2026", "Mantenimiento", "Filtro de aceite", "Repuestos SA",
      "XCMG", "unidad", "1500,50", "4", "800", "10%", "21%", "", "31/8/2026",
      "30", "Transferencia 30 días", "4-7 días", "Sin stock del original", "",
    ];
    const c = parsearFila(fila, r.idx);
    expect(c.proveedor_nombre).toBe("Repuestos SA");
    expect(c.marca).toBe("XCMG");
    expect(c.precio_unitario).toBe(1500.5);
    expect(c.cantidad).toBe(4);
    expect(c.costo_envio).toBe(800);
    expect(c.descuento).toBe(0.1);
    expect(c.iva).toBe(0.21);
    expect(c.precio_hasta).toBe("2026-08-31");
    expect(c.plazo_pago_dias).toBe(30);
    expect(c.disponibilidad).toBe("4-7 días");
  });

  it("una fila sin proveedor ni precio no es un presupuesto", () => {
    const r = mapearEncabezados(ENCABEZADO);
    if (!r.ok) throw new Error("encabezado inválido");
    expect(parsearFila(["1850", "", "", "", "", ""], r.idx)).toBeNull();
  });
});

describe("fila para escribir en la planilla", () => {
  const r = mapearEncabezados(ENCABEZADO);

  it("pone el N° de RI en la columna A y la fórmula del total con el envío", () => {
    if (!r.ok) throw new Error("encabezado inválido");
    const fila = filaParaPlanilla({
      idx: r.idx,
      numeroFila: 7,
      nroRi: 1850,
      fecha: "2026-08-21",
      area: "Mantenimiento",
      descripcion: "Filtro de aceite",
      cotizacion: {
        proveedor_nombre: "Repuestos SA", marca: "XCMG", unidad_medida: "unidad",
        precio_unitario: 1500.5, cantidad: 4, costo_envio: 800,
        descuento: 0.1, iva: 0.21, precio_hasta: "2026-08-31",
        plazo_pago_dias: 30, condiciones_pago: "Transferencia", 
        disponibilidad: "4-7 días", comentario: "",
      },
    });

    expect(fila[0]).toBe("1850");
    expect(fila[4]).toBe("Repuestos SA");
    expect(fila[10]).toBe("10%");
    expect(fila[11]).toBe("21%");
    expect(fila[12]).toBe("=H7*I7*(1-K7)*(1+L7)+J7");
    expect(fila[18]).toBe("FALSE");
    expect(fila).toHaveLength(19);
  });
});

describe("listas de la planilla", () => {
  it("los plazos de pago son los del desplegable", () => {
    expect(PLAZOS_PAGO).toEqual([0, 15, 21, 30, 45, 60, 90, 120, 150]);
  });

  it("la disponibilidad copia el desplegable tal cual, con su error de tipeo", () => {
    // "1-3 día" está en singular en la planilla. Corregirlo acá haría que la
    // validación de Sheets rechace el valor.
    expect(DISPONIBILIDADES[1]).toBe("1-3 día");
  });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run lib/compras/comparativa.test.ts`
Expected: FAIL — `Failed to resolve import "./comparativa"`

- [ ] **Step 3: Escribir el módulo**

```ts
/**
 * La comparativa de proveedores, en la forma que tiene la planilla.
 *
 * Todo lo que se puede decidir sin hablar con Google vive acá: la fórmula del
 * total, el mapeo de columnas por nombre, la regla de la columna A y cómo se
 * arma una fila para escribirla. Así se puede testear sin red y sin
 * credenciales.
 *
 * La plantilla de referencia es "00. COMPARATIVA DE PROVEEDORES GENERICO".
 */

import { norm } from "@/lib/compras/texto";

/** Las 19 columnas de la plantilla, en orden. */
export const COLUMNAS_COMPARATIVA = [
  "NRO RI", "FECHA", "ÁREA", "DESCRIPCION", "PROVEEDOR", "MARCA",
  "UNIDAD DE MEDIDA", "PRECIO UNITARIO", "CANTIDAD", "ENVÍO", "DESCUENTO",
  "IVA", "PRECIO TOTAL", "PRECIO HASTA", "PLAZOS", "CONDICIONES DE PAGO",
  "DISPONIBILIDAD", "COMENTARIO", "ELECCIÓN",
] as const;

/** Días de pago del desplegable de la columna PLAZOS. */
export const PLAZOS_PAGO = [0, 15, 21, 30, 45, 60, 90, 120, 150] as const;

/**
 * Desplegable de DISPONIBILIDAD, copiado tal cual.
 *
 * "1-3 día" está en singular en la planilla. Corregirlo haría que la validación
 * de datos de Sheets rechace el valor al escribirlo.
 */
export const DISPONIBILIDADES = [
  "Inmediata", "1-3 día", "4-7 días", "8-15 días",
  "16-30 días", "31-45 días", "46-60 días",
] as const;

export type ClaveColumna =
  | "nro_ri" | "fecha" | "area" | "descripcion" | "proveedor" | "marca"
  | "unidad_medida" | "precio_unitario" | "cantidad" | "envio" | "descuento"
  | "iva" | "precio_total" | "precio_hasta" | "plazos" | "condiciones_pago"
  | "disponibilidad" | "comentario" | "eleccion";

const ENCABEZADO_DE: Record<ClaveColumna, string> = {
  nro_ri: "NRO RI", fecha: "FECHA", area: "ÁREA", descripcion: "DESCRIPCION",
  proveedor: "PROVEEDOR", marca: "MARCA", unidad_medida: "UNIDAD DE MEDIDA",
  precio_unitario: "PRECIO UNITARIO", cantidad: "CANTIDAD", envio: "ENVÍO",
  descuento: "DESCUENTO", iva: "IVA", precio_total: "PRECIO TOTAL",
  precio_hasta: "PRECIO HASTA", plazos: "PLAZOS",
  condiciones_pago: "CONDICIONES DE PAGO", disponibilidad: "DISPONIBILIDAD",
  comentario: "COMENTARIO", eleccion: "ELECCIÓN",
};

/** Sin estas columnas la planilla no es una comparativa y no se toca. */
const IMPRESCINDIBLES: ClaveColumna[] = ["nro_ri", "proveedor", "precio_unitario"];

export type Indice = Record<ClaveColumna, number>;

export type ResultadoMapeo =
  | { ok: true; idx: Indice }
  | { ok: false; faltan: string[] };

/**
 * Ubica cada columna por NOMBRE, no por posición.
 *
 * Escribir por posición en un archivo con otra estructura es la forma más fácil
 * de arruinar la planilla de alguien. Si falta algo imprescindible, no se
 * escribe: se avisa qué falta.
 */
export function mapearEncabezados(encabezado: string[]): ResultadoMapeo {
  const normalizado = encabezado.map(norm);
  const idx = {} as Indice;

  for (const [clave, titulo] of Object.entries(ENCABEZADO_DE) as [ClaveColumna, string][]) {
    idx[clave] = normalizado.indexOf(norm(titulo));
  }

  const faltan = IMPRESCINDIBLES.filter((c) => idx[c] < 0).map((c) => ENCABEZADO_DE[c]);
  return faltan.length > 0 ? { ok: false, faltan } : { ok: true, idx };
}

// ── Lectura de valores ───────────────────────────────────────

const texto = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

/**
 * Números como los escribe la gente: "1.500,50", "$ 1500", "10%".
 *
 * Un porcentaje vuelve como fracción (10% → 0.1), que es como lo guarda la
 * planilla y como lo espera la fórmula del total.
 */
export function numero(v: unknown): number | null {
  const bruto = String(v ?? "").trim();
  if (bruto === "") return null;

  const esPorcentaje = bruto.includes("%");
  const limpio = bruto.replace(/[^\d.,-]/g, "");
  if (limpio === "") return null;

  // Si tiene los dos separadores, el último es el decimal.
  const ultimaComa = limpio.lastIndexOf(",");
  const ultimoPunto = limpio.lastIndexOf(".");
  let normalizado: string;
  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    normalizado = ultimaComa > ultimoPunto
      ? limpio.replace(/\./g, "").replace(",", ".")
      : limpio.replace(/,/g, "");
  } else {
    normalizado = limpio.replace(",", ".");
  }

  const n = Number(normalizado);
  if (!isFinite(n)) return null;
  return esPorcentaje ? n / 100 : n;
}

/** Fechas de la planilla (d/m/yyyy) a ISO. */
export function fechaISO(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;

  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const anio = y.length === 2 ? `20${y}` : y;
    return `${anio}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const iso = s.match(/^\d{4}-\d{2}-\d{2}/);
  return iso ? iso[0] : null;
}

// ── El total ─────────────────────────────────────────────────

/**
 * El total de un presupuesto.
 *
 * Espeja la columna generada `compras_cotizaciones.precio_total` (migración
 * 026). Existe en TypeScript sólo para mostrarlo mientras alguien escribe el
 * formulario: la que se guarda y por la que se ordena es la de la base. Si una
 * cambia, la otra tiene que cambiar igual — los casos de `comparativa.test.ts`
 * están para que no se pueda mover una sola.
 *
 * La fórmula de la planilla dejaba el envío afuera; acá se suma.
 */
export function totalCotizacion(c: {
  precio_unitario: number | null;
  cantidad: number | null;
  descuento: number | null;
  iva: number | null;
  costo_envio: number | null;
}): number {
  const bruto =
    (c.precio_unitario ?? 0) *
    (c.cantidad ?? 1) *
    (1 - (c.descuento ?? 0)) *
    (1 + (c.iva ?? 0));

  return Math.round((bruto + (c.costo_envio ?? 0)) * 100) / 100;
}

// ── La regla de la columna A ─────────────────────────────────

export interface FilaPropia {
  fila: string[];
  /** Fila real de la planilla, contando el encabezado. */
  numeroFila: number;
}

/**
 * Qué filas de la planilla son de este requerimiento.
 *
 * Los archivos tienen nombres genéricos que no dicen a qué RI corresponden, así
 * que el vínculo es la columna A. Se traen las filas cuya columna A esté vacía
 * —todavía nadie las reclamó— o sea este RI. Las de otro RI se dejan quietas y
 * se cuentan para poder avisar. Así una misma planilla sirve a varios pedidos a
 * lo largo del tiempo sin que se pisen.
 *
 * `filas` no incluye el encabezado; la primera es la fila 2 de la planilla.
 */
export function filasParaEsteRi(
  filas: string[][],
  columnaNroRi: number,
  nroRi: number
): { propias: FilaPropia[]; ajenas: number } {
  const propias: FilaPropia[] = [];
  let ajenas = 0;

  filas.forEach((fila, i) => {
    // Una fila sin nada escrito no es de nadie.
    if (fila.every((c) => String(c ?? "").trim() === "")) return;

    const marca = String(fila[columnaNroRi] ?? "").trim();
    if (marca === "" || Number(marca) === nroRi) {
      propias.push({ fila, numeroFila: i + 2 });
    } else {
      ajenas += 1;
    }
  });

  return { propias, ajenas };
}

// ── Parsear y escribir ───────────────────────────────────────

export interface CotizacionLeida {
  proveedor_nombre: string;
  marca: string | null;
  unidad_medida: string | null;
  precio_unitario: number | null;
  cantidad: number | null;
  costo_envio: number | null;
  descuento: number | null;
  iva: number | null;
  precio_hasta: string | null;
  plazo_pago_dias: number | null;
  condiciones_pago: string | null;
  disponibilidad: string | null;
  comentario: string | null;
}

/** Una fila de la planilla como presupuesto. `null` si no lo es. */
export function parsearFila(fila: string[], idx: Indice): CotizacionLeida | null {
  const en = (c: ClaveColumna) => (idx[c] >= 0 ? fila[idx[c]] : undefined);

  const proveedor = texto(en("proveedor"));
  const unitario = numero(en("precio_unitario"));

  // Sin proveedor o sin precio no hay nada que comparar.
  if (!proveedor || unitario === null) return null;

  return {
    proveedor_nombre: proveedor,
    marca: texto(en("marca")),
    unidad_medida: texto(en("unidad_medida")),
    precio_unitario: unitario,
    cantidad: numero(en("cantidad")),
    costo_envio: numero(en("envio")),
    descuento: numero(en("descuento")),
    iva: numero(en("iva")),
    precio_hasta: fechaISO(en("precio_hasta")),
    plazo_pago_dias: numero(en("plazos")),
    condiciones_pago: texto(en("condiciones_pago")),
    disponibilidad: texto(en("disponibilidad")),
    comentario: texto(en("comentario")),
  };
}

const porcentaje = (v: number | null) =>
  v === null || v === undefined ? "" : `${Math.round(v * 10000) / 100}%`;

/** Letra de columna de Sheets a partir del índice (0 → A). */
export const letraColumna = (i: number) => String.fromCharCode(65 + i);

/**
 * Arma la fila para escribirla en la planilla.
 *
 * El total va como FÓRMULA y no como número, para que la planilla siga siendo
 * una planilla: si alguien corrige un precio ahí, el total se recalcula. Es la
 * fórmula corregida, con el envío sumado — las filas viejas conservan la
 * original hasta que alguien las toque.
 */
export function filaParaPlanilla(args: {
  idx: Indice;
  numeroFila: number;
  nroRi: number;
  fecha: string | null;
  area: string | null;
  descripcion: string | null;
  cotizacion: CotizacionLeida;
}): string[] {
  const { idx, numeroFila: n, nroRi, cotizacion: c } = args;
  const fila = new Array(COLUMNAS_COMPARATIVA.length).fill("");

  const poner = (clave: ClaveColumna, valor: string) => {
    if (idx[clave] >= 0) fila[idx[clave]] = valor;
  };

  const col = (clave: ClaveColumna) => letraColumna(idx[clave]);

  poner("nro_ri", String(nroRi));
  poner("fecha", args.fecha ?? "");
  poner("area", args.area ?? "");
  poner("descripcion", args.descripcion ?? "");
  poner("proveedor", c.proveedor_nombre);
  poner("marca", c.marca ?? "");
  poner("unidad_medida", c.unidad_medida ?? "");
  poner("precio_unitario", c.precio_unitario === null ? "" : String(c.precio_unitario));
  poner("cantidad", c.cantidad === null ? "" : String(c.cantidad));
  poner("envio", c.costo_envio === null ? "" : String(c.costo_envio));
  poner("descuento", porcentaje(c.descuento));
  poner("iva", porcentaje(c.iva));
  poner("precio_hasta", c.precio_hasta ?? "");
  poner("plazos", c.plazo_pago_dias === null ? "" : String(c.plazo_pago_dias));
  poner("condiciones_pago", c.condiciones_pago ?? "");
  poner("disponibilidad", c.disponibilidad ?? "");
  poner("comentario", c.comentario ?? "");
  poner("eleccion", "FALSE");

  if (idx.precio_total >= 0 && idx.precio_unitario >= 0) {
    poner(
      "precio_total",
      `=${col("precio_unitario")}${n}*${col("cantidad")}${n}` +
        `*(1-${col("descuento")}${n})*(1+${col("iva")}${n})` +
        `+${col("envio")}${n}`
    );
  }

  return fila;
}
```

- [ ] **Step 4: Correr los tests**

Run: `npx vitest run lib/compras/comparativa.test.ts`
Expected: PASS — 14 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/compras/comparativa.ts lib/compras/comparativa.test.ts
git commit -m "feat(compras): la logica de la comparativa, con el envio en el total"
```

---

## Tarea 4: El token de Google, con scopes

Listar una carpeta de Drive necesita un scope que `sheets.ts` no pide. El JWT se saca a su propio módulo en vez de duplicarlo.

**Files:**
- Create: `lib/compras/google.ts`
- Modify: `lib/compras/sheets.ts:21-64`

- [ ] **Step 1: Crear el módulo**

Mover el cuerpo de `obtenerToken` de `sheets.ts` (líneas 23-64) tal cual, cambiando sólo cómo se arma el scope:

```ts
/**
 * Autenticación con Google para el módulo Compras.
 *
 * Es un JWT firmado a mano en vez de la librería `googleapis`: son 40 líneas,
 * no arrastra dependencias y funciona igual en el runtime de Vercel.
 *
 * La cuenta de servicio necesita permiso de EDITOR sobre la planilla
 * "PEDIDOS DE COMPRA" y sobre la carpeta de comparativas de Drive.
 */

export const SCOPE_SHEETS = "https://www.googleapis.com/auth/spreadsheets";
export const SCOPE_SHEETS_LECTURA = "https://www.googleapis.com/auth/spreadsheets.readonly";
export const SCOPE_DRIVE_LECTURA = "https://www.googleapis.com/auth/drive.readonly";

export function hayCredencialesGoogle(): boolean {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

export async function obtenerToken(scopes: string[]): Promise<string> {
  const crudo = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "";
  if (!crudo) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON no configurado");

  const cuenta = JSON.parse(crudo);
  const ahora = Math.floor(Date.now() / 1000);
  const carga = {
    iss: cuenta.client_email,
    scope: scopes.join(" "),
    aud: "https://oauth2.googleapis.com/token",
    iat: ahora,
    exp: ahora + 3600,
  };

  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const sinFirmar = `${b64({ alg: "RS256", typ: "JWT" })}.${b64(carga)}`;
  const pem = cuenta.private_key.replace(
    /-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g,
    ""
  );

  const clave = await crypto.subtle.importKey(
    "pkcs8",
    Buffer.from(pem, "base64"),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const firma = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", clave, Buffer.from(sinFirmar));
  const jwt = `${sinFirmar}.${Buffer.from(firma).toString("base64url")}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const datos = await res.json();
  if (!datos.access_token) throw new Error(`Google OAuth: ${JSON.stringify(datos)}`);
  return datos.access_token;
}
```

- [ ] **Step 2: Usarlo en sheets.ts**

Borrar las líneas 21-64 (el bloque `── Autenticación con Google ──` y `obtenerToken`) y poner en su lugar un envoltorio que conserve la firma que ya usan las 6 llamadas del archivo:

```ts
import { obtenerToken as tokenGoogle, SCOPE_SHEETS, SCOPE_SHEETS_LECTURA } from "@/lib/compras/google";

const obtenerToken = (escritura: boolean) =>
  tokenGoogle([escritura ? SCOPE_SHEETS : SCOPE_SHEETS_LECTURA]);
```

- [ ] **Step 3: Verificar que compila y los tests siguen verdes**

Run: `npx tsc --noEmit && npm test`
Expected: sin errores de tipos; tests PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/compras/google.ts lib/compras/sheets.ts
git commit -m "refactor(compras): el token de Google acepta scopes"
```

---

## Tarea 5: Acceso a las comparativas de Drive

**Files:**
- Create: `lib/compras/drive.ts`

- [ ] **Step 1: Escribir el módulo**

```ts
/**
 * Las planillas de comparativa que viven en una carpeta de Drive.
 *
 * Cada archivo es la comparativa de un artículo, con la forma de
 * "00. COMPARATIVA DE PROVEEDORES GENERICO". El vínculo con el requerimiento no
 * es el nombre del archivo —son genéricos— sino la columna A de cada fila.
 *
 * La cuenta de servicio necesita permiso de EDITOR sobre la carpeta: la app no
 * sólo lee, también agrega filas y marca la elección.
 */

import {
  obtenerToken, hayCredencialesGoogle,
  SCOPE_SHEETS, SCOPE_DRIVE_LECTURA,
} from "@/lib/compras/google";
import { letraColumna } from "@/lib/compras/comparativa";

export interface ArchivoComparativa {
  id: string;
  nombre: string;
  modificado: string;
  /** Las planillas nativas se leen con la API; un .xlsx subido, no. */
  esPlanillaGoogle: boolean;
}

const MIME_PLANILLA = "application/vnd.google-apps.spreadsheet";

export function carpetaConfigurada(): boolean {
  return hayCredencialesGoogle() && Boolean(process.env.GOOGLE_DRIVE_COMPARATIVAS_FOLDER_ID);
}

const idCarpeta = () => {
  const id = process.env.GOOGLE_DRIVE_COMPARATIVAS_FOLDER_ID ?? "";
  if (!id) throw new Error("GOOGLE_DRIVE_COMPARATIVAS_FOLDER_ID no configurado");
  return id;
};

/** Los archivos de la carpeta, los más recientes primero. */
export async function listarComparativas(): Promise<ArchivoComparativa[]> {
  const token = await obtenerToken([SCOPE_DRIVE_LECTURA]);
  const parametros = new URLSearchParams({
    q: `'${idCarpeta()}' in parents and trashed = false`,
    fields: "files(id, name, modifiedTime, mimeType)",
    orderBy: "modifiedTime desc",
    pageSize: "200",
  });

  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${parametros}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive API ${res.status}: ${await res.text()}`);

  const json = await res.json();
  return (json.files ?? []).map(
    (f: { id: string; name: string; modifiedTime: string; mimeType: string }) => ({
      id: f.id,
      nombre: f.name,
      modificado: f.modifiedTime,
      esPlanillaGoogle: f.mimeType === MIME_PLANILLA,
    })
  );
}

/** Nombre de la primera pestaña de una planilla. */
async function primeraPestana(token: string, fileId: string): Promise<string> {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${fileId}` +
    `?fields=sheets.properties.title`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${await res.text()}`);

  const json = await res.json();
  const titulo = json.sheets?.[0]?.properties?.title;
  if (!titulo) throw new Error("La planilla no tiene pestañas");
  return titulo;
}

export interface ComparativaLeida {
  pestana: string;
  encabezado: string[];
  filas: string[][];
}

/** Lee una comparativa completa: encabezado y filas. */
export async function leerComparativa(fileId: string): Promise<ComparativaLeida> {
  const token = await obtenerToken([SCOPE_SHEETS]);
  const pestana = await primeraPestana(token, fileId);

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${fileId}` +
    `/values/${encodeURIComponent(pestana)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${await res.text()}`);

  const valores = ((await res.json()).values ?? []) as string[][];
  return { pestana, encabezado: valores[0] ?? [], filas: valores.slice(1) };
}

/**
 * Agrega una fila al final y devuelve qué número de fila quedó.
 *
 * Se usa `append`, que resuelve en una sola llamada dónde va: buscar la primera
 * fila vacía a mano es una carrera con cualquiera que esté editando la planilla
 * en ese momento.
 */
export async function agregarFila(
  fileId: string,
  pestana: string,
  valores: string[]
): Promise<number> {
  const token = await obtenerToken([SCOPE_SHEETS]);
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${fileId}` +
    `/values/${encodeURIComponent(pestana)}:append` +
    `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [valores] }),
  });
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${await res.text()}`);

  // updatedRange viene como "Hoja 1!A7:S7".
  const rango: string = (await res.json()).updates?.updatedRange ?? "";
  const fila = rango.match(/!([A-Z]+)(\d+)/);
  if (!fila) throw new Error(`No se pudo leer la fila escrita: ${rango}`);
  return Number(fila[2]);
}

/** Escribe un valor en una celda de una planilla de la carpeta. */
export async function escribirCelda(
  fileId: string,
  pestana: string,
  columna: number,
  numeroFila: number,
  valor: string
): Promise<void> {
  const token = await obtenerToken([SCOPE_SHEETS]);
  const rango = `${pestana}!${letraColumna(columna)}${numeroFila}`;
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${fileId}` +
    `/values/${encodeURIComponent(rango)}?valueInputOption=USER_ENTERED`;

  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [[valor]] }),
  });
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${await res.text()}`);
}

/**
 * Vacía una fila, sin eliminarla.
 *
 * Eliminar la fila correría todas las de abajo y dejaría mal el `drive_fila` de
 * los demás presupuestos, que es justo lo que ese número existe para evitar.
 */
export async function vaciarFila(
  fileId: string,
  pestana: string,
  numeroFila: number,
  anchoColumnas: number
): Promise<void> {
  const token = await obtenerToken([SCOPE_SHEETS]);
  const rango =
    `${pestana}!A${numeroFila}:${letraColumna(anchoColumnas - 1)}${numeroFila}`;
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${fileId}` +
    `/values/${encodeURIComponent(rango)}:clear`;

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${await res.text()}`);
}

/** El link para abrir la planilla. */
export const urlDePlanilla = (fileId: string) =>
  `https://docs.google.com/spreadsheets/d/${fileId}`;
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add lib/compras/drive.ts
git commit -m "feat(compras): acceso a la carpeta de comparativas de Drive"
```

---

## Tarea 6: Tipos y constantes

**Files:**
- Modify: `lib/compras/types.ts:106-119`
- Modify: `lib/compras/constants.ts:80-86`

- [ ] **Step 1: Actualizar `Cotizacion`**

Reemplazar la interfaz `Cotizacion` por:

```ts
export interface Cotizacion {
  id: string;
  requerimiento_id: string;
  proveedor_id: string;
  marca: string | null;
  unidad_medida: string | null;
  precio_unitario: number | null;
  cantidad: number | null;
  costo_envio: number | null;
  /** Fracciones: 0.10 es 10%. */
  descuento: number | null;
  iva: number | null;
  /** Lo calcula la base (columna generada). */
  precio_total: number | null;
  precio_hasta: string | null;
  plazo_pago_dias: number | null;
  condiciones_pago: string | null;
  disponibilidad: string | null;
  comentario: string | null;
  url: string | null;
  elegida: boolean;
  origen: string;
  drive_fila: number | null;
  created_at: string;
  proveedores?: { nombre: string } | null;
}
```

- [ ] **Step 2: Agregar los campos de la planilla adjunta al requerimiento**

En la interfaz `Requerimiento`, junto a `comparativa_url`:

```ts
  comparativa_drive_id: string | null;
  comparativa_nombre: string | null;
```

- [ ] **Step 3: Actualizar el requisito de PARA_COMPRAR**

En `constants.ts`, reemplazar la entrada de `REQUISITOS`:

```ts
/**
 * Qué hace falta tener cargado para poder pasar a cada estado.
 *
 * No es validación por validación: son los datos que el paso produce. Pasar a
 * PEDIDO sin proveedor ni costo deja un pedido que después nadie puede seguir.
 *
 * `PARA_COMPRAR` ya no exige el link de la comparativa: lo que exige es que
 * haya algo que mirar —un presupuesto cargado o el link— porque si no, la
 * persona asignada no puede elegir. Cuántos presupuestos alcanza lo decide
 * Compras, no el sistema. La verificación vive en la ruta, que es la que puede
 * contar los presupuestos.
 */
export const REQUISITOS: Partial<Record<EstadoCompra, string[]>> = {
  PARA_COMPRAR: ["comparativa", "compra_asignada_a"],
  PEDIDO: ["proveedor_id", "costo_iva"],
};
```

- [ ] **Step 4: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: errores esperables sólo en `RequerimientoDetalle.tsx`, que usa `c.plazo_entrega` y `c.condiciones` (se arreglan en la Tarea 11). Anotarlos y seguir.

- [ ] **Step 5: Commit**

```bash
git add lib/compras/types.ts lib/compras/constants.ts
git commit -m "feat(compras): los tipos de la cotizacion siguen a la planilla"
```

---

## Tarea 7: Adjuntar una planilla y traer sus filas

**Files:**
- Create: `app/api/compras/comparativas/route.ts`
- Create: `app/api/compras/requerimientos/[id]/comparativa/route.ts`

- [ ] **Step 1: Listar los archivos de la carpeta**

`app/api/compras/comparativas/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puedeEditarCompras } from "@/lib/compras/auth";
import { listarComparativas, carpetaConfigurada } from "@/lib/compras/drive";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarCompras(supabase, user.id))) {
    return NextResponse.json({ error: "No tenés permiso para gestionar la compra" }, { status: 403 });
  }

  // En local no hay credenciales de Google: mejor decirlo que devolver una
  // lista vacía que parece una carpeta vacía.
  if (!carpetaConfigurada()) {
    return NextResponse.json({
      archivos: [],
      aviso: "La carpeta de comparativas no está configurada en este entorno.",
    });
  }

  try {
    return NextResponse.json({ archivos: await listarComparativas() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
```

- [ ] **Step 2: Adjuntar y traer**

`app/api/compras/requerimientos/[id]/comparativa/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarCompras } from "@/lib/compras/auth";
import {
  leerComparativa, escribirCelda, urlDePlanilla, carpetaConfigurada,
} from "@/lib/compras/drive";
import { mapearEncabezados, filasParaEsteRi, parsearFila } from "@/lib/compras/comparativa";
import { claveProveedor } from "@/lib/compras/sheets";

/**
 * Adjunta una planilla de la carpeta a un requerimiento y trae sus filas.
 *
 * Es idempotente: se puede volver a llamar para releer la planilla. Al hacerlo
 * se borran los presupuestos que habían venido de Drive —sobre esos manda la
 * planilla— y se dejan intactos los que se cargaron en el sistema.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCompras(supabase, user.id))) {
    return NextResponse.json({ error: "No tenés permiso para gestionar la compra" }, { status: 403 });
  }
  if (!carpetaConfigurada()) {
    return NextResponse.json(
      { error: "La carpeta de comparativas no está configurada en este entorno." },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => null);
  const driveId = String(body?.drive_id ?? "").trim();
  const nombre = String(body?.nombre ?? "").trim();
  if (!driveId) return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });

  const admin = createAdminClient();
  const { data: ri } = await admin
    .from("compras_requerimientos")
    .select("id, nro_ri, estado_compra, estado_aprobacion")
    .eq("id", id)
    .single();

  if (!ri) return NextResponse.json({ error: "El requerimiento no existe" }, { status: 404 });
  if (ri.estado_aprobacion !== "APROBADA") {
    return NextResponse.json(
      { error: "El requerimiento tiene que estar aprobado antes de armar la comparativa" },
      { status: 409 }
    );
  }
  // Una vez aprobada la compra la comparativa es el respaldo de por qué se
  // eligió ese precio: no se toca más.
  if (["APROBADO", "PEDIDO", "RECIBIDO"].includes(ri.estado_compra)) {
    return NextResponse.json(
      { error: "La comparativa quedó congelada al aprobarse la compra" },
      { status: 409 }
    );
  }

  let planilla;
  try {
    planilla = await leerComparativa(driveId);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }

  const mapeo = mapearEncabezados(planilla.encabezado);
  if (!mapeo.ok) {
    return NextResponse.json(
      {
        error:
          `Esa planilla no tiene la forma de una comparativa: faltan las columnas ` +
          mapeo.faltan.join(", ") + ".",
      },
      { status: 409 }
    );
  }

  const { propias, ajenas } = filasParaEsteRi(planilla.filas, mapeo.idx.nro_ri, ri.nro_ri);

  // Proveedores por nombre normalizado, para resolver cada fila.
  const { data: proveedores } = await admin.from("proveedores").select("id, nombre");
  const porNombre = new Map(
    (proveedores ?? []).map((p) => [claveProveedor(p.nombre), p.id])
  );

  const nuevas: Record<string, unknown>[] = [];
  const proveedoresNuevos: string[] = [];
  let sinPrecio = 0;

  for (const { fila, numeroFila } of propias) {
    const leida = parsearFila(fila, mapeo.idx);
    if (!leida) { sinPrecio += 1; continue; }

    let proveedorId = porNombre.get(claveProveedor(leida.proveedor_nombre));
    if (!proveedorId) {
      const { data: creado } = await admin
        .from("proveedores")
        .insert({ nombre: leida.proveedor_nombre })
        .select("id")
        .single();
      if (!creado) continue;
      proveedorId = creado.id;
      porNombre.set(claveProveedor(leida.proveedor_nombre), creado.id);
      proveedoresNuevos.push(leida.proveedor_nombre);
    }

    const { proveedor_nombre: _nombre, ...campos } = leida;
    nuevas.push({
      ...campos,
      requerimiento_id: id,
      proveedor_id: proveedorId,
      origen: "drive",
      drive_fila: numeroFila,
      created_by: user.id,
    });

    // La columna A es el vínculo: si la fila estaba libre, queda reclamada.
    if (String(fila[mapeo.idx.nro_ri] ?? "").trim() === "") {
      try {
        await escribirCelda(driveId, planilla.pestana, mapeo.idx.nro_ri, numeroFila, String(ri.nro_ri));
      } catch {
        // No es motivo para abortar: el presupuesto ya se va a guardar acá.
      }
    }
  }

  // Sobre las filas de la planilla manda la planilla: se reemplazan.
  await admin
    .from("compras_cotizaciones")
    .delete()
    .eq("requerimiento_id", id)
    .eq("origen", "drive");

  if (nuevas.length > 0) {
    const { error } = await admin.from("compras_cotizaciones").insert(nuevas);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const { error: errorRi } = await admin
    .from("compras_requerimientos")
    .update({
      comparativa_drive_id: driveId,
      comparativa_nombre: nombre || null,
      comparativa_url: urlDePlanilla(driveId),
      estado_compra: ri.estado_compra === "SIN_INICIAR" ? "EN_COMPARATIVA" : ri.estado_compra,
    })
    .eq("id", id);

  if (errorRi) return NextResponse.json({ error: errorRi.message }, { status: 400 });

  return NextResponse.json({
    traidas: nuevas.length,
    ajenas,
    sin_precio: sinPrecio,
    proveedores_nuevos: proveedoresNuevos,
  });
}
```

- [ ] **Step 3: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos en estos dos archivos.

- [ ] **Step 4: Commit**

```bash
git add app/api/compras/comparativas app/api/compras/requerimientos/\[id\]/comparativa
git commit -m "feat(compras): adjuntar una comparativa de Drive y traer sus filas"
```

---

## Tarea 8: Cargar, editar y borrar un presupuesto

**Files:**
- Create: `app/api/compras/requerimientos/[id]/cotizaciones/route.ts`
- Create: `app/api/compras/cotizaciones/[id]/route.ts`

- [ ] **Step 1: Cargar un presupuesto**

`app/api/compras/requerimientos/[id]/cotizaciones/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarCompras } from "@/lib/compras/auth";
import { leerComparativa, agregarFila } from "@/lib/compras/drive";
import { mapearEncabezados, filaParaPlanilla } from "@/lib/compras/comparativa";

const CAMPOS = [
  "proveedor_id", "marca", "unidad_medida", "precio_unitario", "cantidad",
  "costo_envio", "descuento", "iva", "precio_hasta", "plazo_pago_dias",
  "condiciones_pago", "disponibilidad", "comentario", "url",
] as const;

/** Estados en los que la comparativa ya es el respaldo de una decisión tomada. */
const CONGELADOS = ["APROBADO", "PEDIDO", "RECIBIDO"];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCompras(supabase, user.id))) {
    return NextResponse.json({ error: "No tenés permiso para gestionar la compra" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body?.proveedor_id) {
    return NextResponse.json({ error: "Hay que elegir el proveedor" }, { status: 400 });
  }
  if (body.precio_unitario === null || body.precio_unitario === undefined || body.precio_unitario === "") {
    return NextResponse.json({ error: "Hay que cargar el precio unitario" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: ri } = await admin
    .from("compras_requerimientos")
    .select("id, nro_ri, fecha, descripcion, estado_compra, estado_aprobacion, comparativa_drive_id, compras_areas(nombre)")
    .eq("id", id)
    .single();

  if (!ri) return NextResponse.json({ error: "El requerimiento no existe" }, { status: 404 });
  if (ri.estado_aprobacion !== "APROBADA") {
    return NextResponse.json(
      { error: "El requerimiento tiene que estar aprobado antes de cargar presupuestos" },
      { status: 409 }
    );
  }
  if (CONGELADOS.includes(ri.estado_compra)) {
    return NextResponse.json(
      { error: "La comparativa quedó congelada al aprobarse la compra" },
      { status: 409 }
    );
  }

  const registro: Record<string, unknown> = {
    requerimiento_id: id,
    origen: "app",
    created_by: user.id,
  };
  for (const campo of CAMPOS) if (campo in body) registro[campo] = body[campo] === "" ? null : body[campo];

  const { data: cotizacion, error } = await admin
    .from("compras_cotizaciones")
    .insert(registro)
    .select("*, proveedores(nombre)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Cargar el primer presupuesto pone el RI en comparativa: es el trabajo que
  // el estado describe.
  if (ri.estado_compra === "SIN_INICIAR") {
    await admin
      .from("compras_requerimientos")
      .update({ estado_compra: "EN_COMPARATIVA" })
      .eq("id", id);
  }

  // La planilla se sigue llenando. Si falla, el presupuesto ya está guardado:
  // se avisa, igual que hace la sincronización con el master.
  let avisoDrive: string | null = null;
  if (ri.comparativa_drive_id) {
    try {
      const planilla = await leerComparativa(ri.comparativa_drive_id);
      const mapeo = mapearEncabezados(planilla.encabezado);
      if (!mapeo.ok) {
        avisoDrive =
          "El presupuesto se guardó, pero la planilla no tiene la forma esperada " +
          `(faltan ${mapeo.faltan.join(", ")}): no se escribió ahí.`;
      } else {
        // La fila se conoce recién al escribirla, y la fórmula del total la
        // necesita: se escribe con el número que devuelve append y se corrige.
        const proximaFila = planilla.filas.length + 2;
        const fila = filaParaPlanilla({
          idx: mapeo.idx,
          numeroFila: proximaFila,
          nroRi: ri.nro_ri,
          fecha: ri.fecha,
          area: (ri.compras_areas as { nombre: string } | null)?.nombre ?? null,
          descripcion: ri.descripcion,
          cotizacion: {
            proveedor_nombre: cotizacion.proveedores?.nombre ?? "",
            marca: cotizacion.marca,
            unidad_medida: cotizacion.unidad_medida,
            precio_unitario: cotizacion.precio_unitario,
            cantidad: cotizacion.cantidad,
            costo_envio: cotizacion.costo_envio,
            descuento: cotizacion.descuento,
            iva: cotizacion.iva,
            precio_hasta: cotizacion.precio_hasta,
            plazo_pago_dias: cotizacion.plazo_pago_dias,
            condiciones_pago: cotizacion.condiciones_pago,
            disponibilidad: cotizacion.disponibilidad,
            comentario: cotizacion.comentario,
          },
        });

        const filaEscrita = await agregarFila(ri.comparativa_drive_id, planilla.pestana, fila);
        await admin
          .from("compras_cotizaciones")
          .update({ drive_fila: filaEscrita })
          .eq("id", cotizacion.id);
      }
    } catch (e) {
      avisoDrive =
        "El presupuesto se guardó, pero no se pudo escribir en la planilla: " +
        (e instanceof Error ? e.message : String(e));
    }
  }

  return NextResponse.json(
    avisoDrive ? { ...cotizacion, aviso_drive: avisoDrive } : cotizacion,
    { status: 201 }
  );
}
```

- [ ] **Step 2: Editar y borrar**

`app/api/compras/cotizaciones/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarCompras } from "@/lib/compras/auth";
import { leerComparativa, vaciarFila } from "@/lib/compras/drive";
import { COLUMNAS_COMPARATIVA } from "@/lib/compras/comparativa";

const CAMPOS = [
  "marca", "unidad_medida", "precio_unitario", "cantidad", "costo_envio",
  "descuento", "iva", "precio_hasta", "plazo_pago_dias", "condiciones_pago",
  "disponibilidad", "comentario", "url",
] as const;

const CONGELADOS = ["APROBADO", "PEDIDO", "RECIBIDO"];

/** Trae la cotización con el estado del requerimiento, para poder decidir. */
async function contexto(admin: ReturnType<typeof createAdminClient>, id: string) {
  const { data } = await admin
    .from("compras_cotizaciones")
    .select("*, compras_requerimientos(id, estado_compra, comparativa_drive_id)")
    .eq("id", id)
    .single();
  return data;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCompras(supabase, user.id))) {
    return NextResponse.json({ error: "No tenés permiso para gestionar la compra" }, { status: 403 });
  }

  const admin = createAdminClient();
  const cotizacion = await contexto(admin, id);
  if (!cotizacion) return NextResponse.json({ error: "El presupuesto no existe" }, { status: 404 });

  const ri = cotizacion.compras_requerimientos as { estado_compra: string };
  if (CONGELADOS.includes(ri.estado_compra)) {
    return NextResponse.json(
      { error: "La comparativa quedó congelada al aprobarse la compra" },
      { status: 409 }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });

  const cambios: Record<string, unknown> = {};
  for (const campo of CAMPOS) if (campo in body) cambios[campo] = body[campo] === "" ? null : body[campo];
  if (Object.keys(cambios).length === 0) {
    return NextResponse.json({ error: "No se envió ningún cambio válido" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("compras_cotizaciones")
    .update(cambios)
    .eq("id", id)
    .select("*, proveedores(nombre)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Editar acá no reescribe la fila de la planilla: la fórmula del total y el
  // resto de la fila quedan como estaban. Se avisa para que no se asuma que
  // Drive quedó al día.
  const aviso = cotizacion.drive_fila
    ? "El cambio se guardó en el sistema. La fila de la planilla no se reescribió: si hace falta, corregila ahí."
    : null;

  return NextResponse.json(aviso ? { ...data, aviso_drive: aviso } : data);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCompras(supabase, user.id))) {
    return NextResponse.json({ error: "No tenés permiso para gestionar la compra" }, { status: 403 });
  }

  const admin = createAdminClient();
  const cotizacion = await contexto(admin, id);
  if (!cotizacion) return NextResponse.json({ error: "El presupuesto no existe" }, { status: 404 });

  const ri = cotizacion.compras_requerimientos as {
    estado_compra: string; comparativa_drive_id: string | null;
  };
  if (CONGELADOS.includes(ri.estado_compra)) {
    return NextResponse.json(
      { error: "La comparativa quedó congelada al aprobarse la compra" },
      { status: 409 }
    );
  }

  const { error } = await admin.from("compras_cotizaciones").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  let avisoDrive: string | null = null;
  if (ri.comparativa_drive_id && cotizacion.drive_fila) {
    try {
      const planilla = await leerComparativa(ri.comparativa_drive_id);
      await vaciarFila(
        ri.comparativa_drive_id, planilla.pestana,
        cotizacion.drive_fila, COLUMNAS_COMPARATIVA.length
      );
    } catch (e) {
      avisoDrive =
        "El presupuesto se borró, pero la fila de la planilla quedó: " +
        (e instanceof Error ? e.message : String(e));
    }
  }

  return NextResponse.json({ ok: true, aviso_drive: avisoDrive });
}
```

- [ ] **Step 3: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos en estos archivos.

- [ ] **Step 4: Commit**

```bash
git add app/api/compras/requerimientos/\[id\]/cotizaciones app/api/compras/cotizaciones
git commit -m "feat(compras): cargar, editar y borrar presupuestos desde la app"
```

---

## Tarea 9: Elegir un presupuesto es aprobar la compra

**Files:**
- Create: `app/api/compras/cotizaciones/[id]/elegir/route.ts`

- [ ] **Step 1: Escribir la ruta**

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { leerComparativa, escribirCelda } from "@/lib/compras/drive";
import { mapearEncabezados } from "@/lib/compras/comparativa";
import { exportarRequerimiento } from "@/lib/compras/sheets";

/**
 * Elegir un presupuesto ES aprobar la compra.
 *
 * No son dos actos: quien elige es la persona a la que Compras le asignó el
 * pedido —NICO o MAXI—, y su elección es lo que hace avanzar el circuito. Por
 * eso esto no es un PATCH de `elegida`: es una acción, con su propio permiso.
 *
 * Ser admin del sistema no alcanza, igual que para aprobar el RI: tiene que ser
 * la persona asignada. En la planilla el estado dice a quién le toca, y que
 * apruebe otro dejaría los dos lados diciendo cosas distintas.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data: usuario } = await supabase
    .from("usuarios").select("nombre, apellido, activo").eq("id", user.id).single();
  if (!usuario?.activo) return NextResponse.json({ error: "Usuario desactivado" }, { status: 403 });

  const admin = createAdminClient();
  const { data: cotizacion } = await admin
    .from("compras_cotizaciones")
    .select("id, requerimiento_id, proveedor_id, drive_fila")
    .eq("id", id)
    .single();
  if (!cotizacion) return NextResponse.json({ error: "El presupuesto no existe" }, { status: 404 });

  const { data: ri } = await admin
    .from("compras_requerimientos")
    .select("id, estado_compra, compra_asignada_a, comparativa_drive_id")
    .eq("id", cotizacion.requerimiento_id)
    .single();
  if (!ri) return NextResponse.json({ error: "El requerimiento no existe" }, { status: 404 });

  if (ri.compra_asignada_a !== user.id) {
    return NextResponse.json(
      { error: "Esta compra la tiene que aprobar la persona a la que se le asignó" },
      { status: 403 }
    );
  }
  if (ri.estado_compra !== "PARA_COMPRAR") {
    return NextResponse.json(
      { error: "Sólo se puede elegir un presupuesto cuando la compra está para comprar" },
      { status: 409 }
    );
  }

  // Una sola elegida por requerimiento.
  await admin
    .from("compras_cotizaciones")
    .update({ elegida: false })
    .eq("requerimiento_id", ri.id);

  const { error: errorElegir } = await admin
    .from("compras_cotizaciones")
    .update({ elegida: true })
    .eq("id", id);
  if (errorElegir) return NextResponse.json({ error: errorElegir.message }, { status: 400 });

  const nombreUsuario = `${usuario.nombre} ${usuario.apellido}`.trim();
  const { error: errorRi } = await admin
    .from("compras_requerimientos")
    .update({
      estado_compra: "APROBADO",
      compra_aprobada_por: user.id,
      compra_aprobada_en: new Date().toISOString(),
    })
    .eq("id", ri.id);
  if (errorRi) return NextResponse.json({ error: errorRi.message }, { status: 400 });

  await admin
    .from("compras_historial")
    .update({ usuario_id: user.id, usuario_nombre: nombreUsuario })
    .eq("requerimiento_id", ri.id)
    .is("usuario_id", null);

  const avisos: string[] = [];

  // La casilla ELECCIÓN de la planilla es la que dispara el formato condicional
  // que pinta la fila elegida.
  if (ri.comparativa_drive_id && cotizacion.drive_fila) {
    try {
      const planilla = await leerComparativa(ri.comparativa_drive_id);
      const mapeo = mapearEncabezados(planilla.encabezado);
      if (mapeo.ok && mapeo.idx.eleccion >= 0) {
        await escribirCelda(
          ri.comparativa_drive_id, planilla.pestana,
          mapeo.idx.eleccion, cotizacion.drive_fila, "TRUE"
        );
      }
    } catch (e) {
      avisos.push(
        "La compra quedó aprobada, pero no se pudo marcar la elección en la planilla: " +
        (e instanceof Error ? e.message : String(e))
      );
    }
  }

  // El estado de compra va al master, como cualquier otro cambio.
  try {
    const { bloqueadas } = await exportarRequerimiento(ri.id);
    if (bloqueadas.length > 0) {
      avisos.push(
        "La planilla no dejó actualizar: " + bloqueadas.join(", ") +
        ". Hay que corregirlo a mano ahí."
      );
    }
  } catch (e) {
    avisos.push(e instanceof Error ? e.message : String(e));
  }

  return NextResponse.json({
    ok: true,
    aviso_drive: avisos.length > 0 ? avisos.join(" ") : null,
  });
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 3: Commit**

```bash
git add app/api/compras/cotizaciones/\[id\]/elegir
git commit -m "feat(compras): elegir un presupuesto es aprobar la compra"
```

---

## Tarea 10: El circuito (TDD)

Tres cambios en `app/api/compras/requerimientos/[id]/route.ts` y el test que fija el primero.

**Files:**
- Modify: `lib/compras/circuito.test.ts`
- Modify: `app/api/compras/requerimientos/[id]/route.ts:130-200`

- [ ] **Step 1: Escribir el test del estado al aprobar**

Agregar al final de `lib/compras/circuito.test.ts`:

```ts
/**
 * Aprobar un RI lo deja al principio del circuito de compra, no en
 * PARA_COMPRAR: todavía falta juntar los presupuestos. La migración 025 ya
 * corrigió los datos, pero la ruta seguía poniendo PARA_COMPRAR — y como lo
 * hacía en la rama de aprobación, tampoco se validaban los requisitos, así que
 * el RI quedaba "para comprar" sin comparativa ni asignado.
 */
describe("aprobar un RI lo pone a juntar presupuestos", () => {
  it("el primer estado del circuito de compra es EN_COMPARATIVA", () => {
    expect(SIGUIENTE_ESTADO.SIN_INICIAR).toBe("EN_COMPARATIVA");
  });

  it("PARA_COMPRAR exige la comparativa y a quién le toca", () => {
    expect(REQUISITOS.PARA_COMPRAR).toEqual(["comparativa", "compra_asignada_a"]);
  });
});
```

Agregar `REQUISITOS` al import de `./constants` al principio del archivo.

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run lib/compras/circuito.test.ts`
Expected: FAIL en el segundo caso — `REQUISITOS.PARA_COMPRAR` todavía dice `["comparativa_url", "compra_asignada_a"]` si no se hizo la Tarea 6, o PASS si ya se hizo. Si pasa por la Tarea 6, dejarlo: el test es la red que impide volver atrás.

- [ ] **Step 3: Corregir el estado al aprobar**

En `app/api/compras/requerimientos/[id]/route.ts`, en la rama de aprobación, reemplazar:

```ts
      // Aprobar pone el pedido en la cola de Compras; denegar lo cierra.
      if (cambios.estado_aprobacion === "APROBADA" && actual.estado_compra === "SIN_INICIAR") {
        cambios.estado_compra = "PARA_COMPRAR";
      }
```

por:

```ts
      // Aprobar pone el pedido a juntar presupuestos, que es el paso que sigue.
      // Antes lo dejaba en PARA_COMPRAR, salteando la comparativa: y como esta
      // asignación no pasa por la validación de requisitos —que vive en la rama
      // de compra— el RI quedaba "para comprar" sin comparativa ni asignado.
      if (cambios.estado_aprobacion === "APROBADA" && actual.estado_compra === "SIN_INICIAR") {
        cambios.estado_compra = "EN_COMPARATIVA";
      }
```

- [ ] **Step 4: Cambiar el requisito de PARA_COMPRAR y exigir elegida para APROBADO**

En la rama de compra, reemplazar el bloque `FALTA` y su uso. El diccionario pasa a:

```ts
/** Qué hace falta tener cargado antes de pasar a cada estado. */
const FALTA: Record<string, { campo: string; queda: string }[]> = {
  PEDIDO: [
    { campo: "proveedor_id", queda: "el proveedor elegido" },
    { campo: "costo_iva", queda: "el costo + IVA" },
  ],
};
```

Y justo antes del bucle de `FALTA`, agregar las dos reglas que necesitan contar presupuestos:

```ts
    // Cuántos presupuestos alcanza lo decide Compras. Lo que el sistema exige
    // es que haya algo que mirar: sin eso, la persona asignada no puede elegir.
    if (nuevoEstado === "PARA_COMPRAR") {
      const { count } = await admin
        .from("compras_cotizaciones")
        .select("id", { count: "exact", head: true })
        .eq("requerimiento_id", id);

      const hayComparativa = (count ?? 0) > 0 || Boolean(
        "comparativa_url" in cambios ? cambios.comparativa_url : actual.comparativa_url
      );
      if (!hayComparativa) {
        return NextResponse.json(
          { error: "Antes de avanzar hay que cargar al menos un presupuesto o el link de la comparativa." },
          { status: 409 }
        );
      }

      const asignado = "compra_asignada_a" in cambios ? cambios.compra_asignada_a : actual.compra_asignada_a;
      if (!asignado) {
        return NextResponse.json(
          { error: "Antes de avanzar hay que cargar a quién le toca aprobarla." },
          { status: 409 }
        );
      }
    }

    // Aprobar la compra es elegir un presupuesto. Si hay presupuestos cargados
    // y ninguno está elegido, esto se llamó por la vía equivocada: la que
    // corresponde es POST /api/compras/cotizaciones/[id]/elegir.
    if (nuevoEstado === "APROBADO") {
      const { data: cotizaciones } = await admin
        .from("compras_cotizaciones")
        .select("id, elegida")
        .eq("requerimiento_id", id);

      const hay = (cotizaciones ?? []).length > 0;
      const elegida = (cotizaciones ?? []).some((c) => c.elegida);
      if (hay && !elegida) {
        return NextResponse.json(
          { error: "Para aprobar la compra hay que elegir uno de los presupuestos." },
          { status: 409 }
        );
      }
    }
```

- [ ] **Step 5: Bajar proveedor y costos al pasar a PEDIDO**

Antes del bucle de `FALTA` (así los requisitos de `PEDIDO` ven los valores ya completados):

```ts
    // Al registrar el pedido, el proveedor y los costos salen del presupuesto
    // elegido en vez de tipearse de nuevo. `costo_iva` es el total sin el
    // envío, porque en el RI el envío va en su propio campo y la ficha suma los
    // dos: así el total del RI coincide con el del presupuesto.
    if (nuevoEstado === "PEDIDO") {
      const { data: elegida } = await admin
        .from("compras_cotizaciones")
        .select("proveedor_id, precio_total, costo_envio")
        .eq("requerimiento_id", id)
        .eq("elegida", true)
        .maybeSingle();

      if (elegida) {
        const envio = elegida.costo_envio ?? 0;
        if (!("proveedor_id" in cambios) && !actual.proveedor_id) {
          cambios.proveedor_id = elegida.proveedor_id;
        }
        if (!("costo_iva" in cambios) && actual.costo_iva === null) {
          cambios.costo_iva = Number(((elegida.precio_total ?? 0) - envio).toFixed(2));
        }
        if (!("costo_envio" in cambios) && actual.costo_envio === null) {
          cambios.costo_envio = envio;
        }
      }
    }
```

- [ ] **Step 6: Correr los tests**

Run: `npm test`
Expected: PASS, incluidos los dos casos nuevos de `circuito.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add lib/compras/circuito.test.ts app/api/compras/requerimientos/\[id\]/route.ts
git commit -m "fix(compras): aprobar un RI lo manda a juntar presupuestos, no a comprar"
```

---

## Tarea 11: El selector de planilla

**Files:**
- Create: `app/(app)/compras/requerimientos/[id]/SelectorComparativa.tsx`

- [ ] **Step 1: Escribir el componente**

```tsx
"use client";

import { useEffect, useState } from "react";
import { fechaHora } from "@/lib/compras/constants";

interface Archivo {
  id: string;
  nombre: string;
  modificado: string;
  esPlanillaGoogle: boolean;
}

/**
 * Elegir de la carpeta de Drive la planilla de comparativa de este pedido.
 *
 * Los nombres son genéricos y no dicen a qué RI corresponden, así que esto no
 * se puede adivinar: lo elige la persona. Al elegir, el sistema trae las filas
 * que estén libres o ya sean de este RI.
 */
export default function SelectorComparativa({
  requerimientoId, onListo, onCerrar,
}: {
  requerimientoId: string;
  onListo: (mensaje: string) => void;
  onCerrar: () => void;
}) {
  const [archivos, setArchivos] = useState<Archivo[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [adjuntando, setAdjuntando] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/compras/comparativas")
      .then((r) => r.json())
      .then((body) => {
        if (body.error) setError(body.error);
        else if (body.aviso) setError(body.aviso);
        else setArchivos(body.archivos ?? []);
      })
      .catch(() => setError("No se pudo leer la carpeta de comparativas."))
      .finally(() => setCargando(false));
  }, []);

  async function adjuntar(archivo: Archivo) {
    setAdjuntando(archivo.id);
    setError("");

    const res = await fetch(`/api/compras/requerimientos/${requerimientoId}/comparativa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drive_id: archivo.id, nombre: archivo.nombre }),
    });
    const body = await res.json().catch(() => ({}));
    setAdjuntando(null);

    if (!res.ok) {
      setError(body.error ?? "No se pudo adjuntar la comparativa.");
      return;
    }

    const partes = [`Se trajeron ${body.traidas} presupuesto(s).`];
    if (body.ajenas > 0) partes.push(`${body.ajenas} fila(s) son de otro RI y se dejaron como estaban.`);
    if (body.sin_precio > 0) partes.push(`${body.sin_precio} fila(s) sin precio se ignoraron.`);
    if (body.proveedores_nuevos?.length) {
      partes.push(`Proveedores nuevos: ${body.proveedores_nuevos.join(", ")}.`);
    }
    onListo(partes.join(" "));
  }

  const visibles = archivos.filter((a) =>
    a.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 sm:p-8">
      <div className="max-h-full w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold text-slate-900">Elegir comparativa</h2>
          <button onClick={onCerrar} className="text-slate-400 hover:text-slate-700">✕</button>
        </div>

        <div className="space-y-3 p-5">
          <input
            autoFocus
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />

          {error && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {error}
            </div>
          )}

          {cargando ? (
            <p className="py-6 text-center text-sm text-slate-400">Leyendo la carpeta…</p>
          ) : visibles.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">
              {archivos.length === 0 ? "No hay archivos en la carpeta." : "Ningún archivo coincide."}
            </p>
          ) : (
            <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
              {visibles.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-900">{a.nombre}</p>
                    <p className="text-xs text-slate-400">
                      Modificada {fechaHora(a.modificado)}
                      {!a.esPlanillaGoogle && " · no es una planilla de Google"}
                    </p>
                  </div>
                  <button
                    onClick={() => adjuntar(a)}
                    disabled={!a.esPlanillaGoogle || adjuntando !== null}
                    className="shrink-0 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-40"
                  >
                    {adjuntando === a.id ? "Trayendo…" : "Usar esta"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/compras/requerimientos/[id]/SelectorComparativa.tsx"
git commit -m "feat(compras): elegir la planilla de comparativa desde la app"
```

---

## Tarea 12: El formulario de presupuesto y la tabla

**Files:**
- Create: `app/(app)/compras/requerimientos/[id]/PresupuestoForm.tsx`
- Create: `app/(app)/compras/requerimientos/[id]/Comparativa.tsx`
- Modify: `app/(app)/compras/requerimientos/[id]/page.tsx`
- Modify: `app/(app)/compras/requerimientos/[id]/RequerimientoDetalle.tsx:224-257`

- [ ] **Step 1: El formulario**

`PresupuestoForm.tsx`. El total se muestra con `totalCotizacion`, la misma fórmula que la base:

```tsx
"use client";

import { useState } from "react";
import { moneda } from "@/lib/compras/constants";
import { totalCotizacion, PLAZOS_PAGO, DISPONIBILIDADES } from "@/lib/compras/comparativa";

/** Campos tal como los pide la planilla. Los porcentajes se escriben como 10, no 0.1. */
export default function PresupuestoForm({
  requerimientoId, proveedores, cantidadSugerida, onListo, onCancelar,
}: {
  requerimientoId: string;
  proveedores: { id: string; nombre: string }[];
  cantidadSugerida: number | null;
  onListo: (aviso: string | null) => void;
  onCancelar: () => void;
}) {
  const [proveedorId, setProveedorId] = useState("");
  const [marca, setMarca] = useState("");
  const [unidad, setUnidad] = useState("");
  const [unitario, setUnitario] = useState("");
  const [cantidad, setCantidad] = useState(cantidadSugerida ? String(cantidadSugerida) : "");
  const [envio, setEnvio] = useState("");
  const [descuento, setDescuento] = useState("0");
  const [iva, setIva] = useState("21");
  const [precioHasta, setPrecioHasta] = useState("");
  const [plazo, setPlazo] = useState("");
  const [condiciones, setCondiciones] = useState("");
  const [disponibilidad, setDisponibilidad] = useState("");
  const [comentario, setComentario] = useState("");

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

  const total = totalCotizacion({
    precio_unitario: num(unitario),
    cantidad: num(cantidad),
    descuento: (num(descuento) ?? 0) / 100,
    iva: (num(iva) ?? 0) / 100,
    costo_envio: num(envio),
  });

  async function guardar() {
    setGuardando(true);
    setError("");

    const res = await fetch(`/api/compras/requerimientos/${requerimientoId}/cotizaciones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proveedor_id: proveedorId,
        marca: marca.trim() || null,
        unidad_medida: unidad.trim() || null,
        precio_unitario: num(unitario),
        cantidad: num(cantidad),
        costo_envio: num(envio),
        descuento: (num(descuento) ?? 0) / 100,
        iva: (num(iva) ?? 0) / 100,
        precio_hasta: precioHasta || null,
        plazo_pago_dias: num(plazo),
        condiciones_pago: condiciones.trim() || null,
        disponibilidad: disponibilidad || null,
        comentario: comentario.trim() || null,
      }),
    });

    const body = await res.json().catch(() => ({}));
    setGuardando(false);
    if (!res.ok) {
      setError(body.error ?? "No se pudo guardar el presupuesto.");
      return;
    }
    onListo(body.aviso_drive ?? null);
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Campo label="Proveedor" ancho="sm:col-span-2">
          <select
            value={proveedorId}
            onChange={(e) => setProveedorId(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Elegir…</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre}</option>
            ))}
          </select>
        </Campo>
        <Campo label="Marca"><Texto valor={marca} set={setMarca} /></Campo>

        <Campo label="Precio unitario"><Texto valor={unitario} set={setUnitario} /></Campo>
        <Campo label="Cantidad"><Texto valor={cantidad} set={setCantidad} /></Campo>
        <Campo label="Unidad de medida"><Texto valor={unidad} set={setUnidad} /></Campo>

        <Campo label="Envío"><Texto valor={envio} set={setEnvio} /></Campo>
        <Campo label="Descuento %"><Texto valor={descuento} set={setDescuento} /></Campo>
        <Campo label="IVA %"><Texto valor={iva} set={setIva} /></Campo>

        <Campo label="Precio válido hasta">
          <input
            type="date"
            value={precioHasta}
            onChange={(e) => setPrecioHasta(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </Campo>
        <Campo label="Plazo de pago (días)">
          <select
            value={plazo}
            onChange={(e) => setPlazo(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">—</option>
            {PLAZOS_PAGO.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Campo>
        <Campo label="Disponibilidad">
          <select
            value={disponibilidad}
            onChange={(e) => setDisponibilidad(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">—</option>
            {DISPONIBILIDADES.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Campo>

        <Campo label="Condiciones de pago" ancho="sm:col-span-3">
          <Texto valor={condiciones} set={setCondiciones} />
        </Campo>
        <Campo label="Comentario" ancho="sm:col-span-3">
          <Texto valor={comentario} set={setComentario} />
        </Campo>
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 pt-3">
        <p className="text-sm text-slate-600">
          Total con IVA y envío: <strong className="font-mono">{moneda(total)}</strong>
        </p>
        <div className="flex gap-2">
          <button onClick={onCancelar} className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:text-slate-900">
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando || !proveedorId || unitario.trim() === ""}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Guardar presupuesto"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Campo({ label, ancho = "", children }: {
  label: string; ancho?: string; children: React.ReactNode;
}) {
  return (
    <label className={`block ${ancho}`}>
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function Texto({ valor, set }: { valor: string; set: (v: string) => void }) {
  return (
    <input
      value={valor}
      onChange={(e) => set(e.target.value)}
      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
    />
  );
}
```

- [ ] **Step 2: La sección de comparativa**

`Comparativa.tsx`. Primera versión de la tabla: el refinamiento visual se trabaja con el usuario después.

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { moneda, fecha } from "@/lib/compras/constants";
import type { Cotizacion, RequerimientoConRelaciones } from "@/lib/compras/types";
import SelectorComparativa from "./SelectorComparativa";
import PresupuestoForm from "./PresupuestoForm";

/**
 * La comparativa de un requerimiento.
 *
 * Compras adjunta la planilla de Drive, carga los presupuestos y designa a
 * quién le toca. La persona asignada aprueba la compra eligiendo uno: elegir es
 * el acto de aprobar, no un paso previo.
 *
 * Al aprobarse la compra la comparativa se congela: es el respaldo de por qué
 * se eligió ese precio.
 */
export default function Comparativa({
  requerimiento: r, cotizaciones, proveedores, puedeEditar, esAsignado,
}: {
  requerimiento: RequerimientoConRelaciones;
  cotizaciones: Cotizacion[];
  proveedores: { id: string; nombre: string }[];
  puedeEditar: boolean;
  esAsignado: boolean;
}) {
  const router = useRouter();
  const [selector, setSelector] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [eligiendo, setEligiendo] = useState<string | null>(null);
  const [trayendo, setTrayendo] = useState(false);

  const congelada = ["APROBADO", "PEDIDO", "RECIBIDO"].includes(r.estado_compra);
  const puedeCargar = puedeEditar && !congelada && r.estado_aprobacion === "APROBADA";
  const puedeElegir = esAsignado && r.estado_compra === "PARA_COMPRAR";

  // Ordenadas por total: el más barato primero. Es información, no una
  // decisión: el plazo, la disponibilidad y la marca también pesan.
  const ordenadas = [...cotizaciones].sort(
    (a, b) => (a.precio_total ?? Infinity) - (b.precio_total ?? Infinity)
  );
  const masBarato = ordenadas.find((c) => c.precio_total !== null)?.id;
  const hoy = new Date().toISOString().slice(0, 10);

  function refrescar(mensaje: string | null) {
    setAviso(mensaje);
    setSelector(false);
    setCargando(false);
    router.refresh();
  }

  /**
   * Relee la planilla adjunta.
   *
   * Se borran los presupuestos que habían venido de Drive —sobre esos manda la
   * planilla— y quedan intactos los que se cargaron acá. Lo resuelve la misma
   * ruta que adjuntar: es idempotente a propósito.
   */
  async function volverATraer() {
    if (!r.comparativa_drive_id) return;
    setTrayendo(true);
    setError("");

    const res = await fetch(`/api/compras/requerimientos/${r.id}/comparativa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drive_id: r.comparativa_drive_id, nombre: r.comparativa_nombre }),
    });
    const body = await res.json().catch(() => ({}));
    setTrayendo(false);

    if (!res.ok) {
      setError(body.error ?? "No se pudo releer la planilla.");
      return;
    }
    refrescar(`Se releyó la planilla: ${body.traidas} presupuesto(s).`);
  }

  async function elegir(cotizacion: Cotizacion) {
    setEligiendo(cotizacion.id);
    setError("");
    const res = await fetch(`/api/compras/cotizaciones/${cotizacion.id}/elegir`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setEligiendo(null);
    if (!res.ok) {
      setError(body.error ?? "No se pudo aprobar la compra.");
      return;
    }
    refrescar(body.aviso_drive ?? null);
  }

  async function borrar(cotizacion: Cotizacion) {
    if (!confirm(`¿Borrar el presupuesto de ${cotizacion.proveedores?.nombre ?? "ese proveedor"}?`)) return;
    const res = await fetch(`/api/compras/cotizaciones/${cotizacion.id}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "No se pudo borrar.");
      return;
    }
    refrescar(body.aviso_drive ?? null);
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Comparativa de proveedores
          </h2>
          {r.comparativa_nombre && (
            <p className="mt-0.5 text-sm text-slate-600">
              Planilla: {r.comparativa_url ? (
                <a href={r.comparativa_url} target="_blank" rel="noreferrer" className="underline">
                  {r.comparativa_nombre}
                </a>
              ) : r.comparativa_nombre}
            </p>
          )}
        </div>

        {puedeCargar && (
          <div className="flex gap-2">
            <button
              onClick={() => setSelector(true)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {r.comparativa_drive_id ? "Cambiar planilla" : "Elegir comparativa de Drive"}
            </button>
            {r.comparativa_drive_id && (
              <button
                onClick={volverATraer}
                disabled={trayendo}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {trayendo ? "Trayendo…" : "Volver a traer"}
              </button>
            )}
            {!cargando && (
              <button
                onClick={() => setCargando(true)}
                className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--primary-dark)]"
              >
                Cargar presupuesto
              </button>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3 p-5">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
        {aviso && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{aviso}</div>
        )}

        {cargando && (
          <PresupuestoForm
            requerimientoId={r.id}
            proveedores={proveedores}
            cantidadSugerida={r.cantidad}
            onListo={(a) => refrescar(a)}
            onCancelar={() => setCargando(false)}
          />
        )}

        {ordenadas.length === 0 ? (
          <p className="text-sm text-slate-400">
            Todavía no hay presupuestos cargados.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Proveedor</th>
                  <th className="px-3 py-2 text-left">Marca</th>
                  <th className="px-3 py-2 text-right">Unitario</th>
                  <th className="px-3 py-2 text-right">Cant.</th>
                  <th className="px-3 py-2 text-right">Envío</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-left">Pago</th>
                  <th className="px-3 py-2 text-left">Disponibilidad</th>
                  <th className="px-3 py-2 text-left">Vale hasta</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ordenadas.map((c) => {
                  const vencido = c.precio_hasta !== null && c.precio_hasta < hoy;
                  return (
                    <tr key={c.id} className={c.elegida ? "bg-green-50" : ""}>
                      <td className={`px-3 py-2 ${c.elegida ? "font-semibold" : ""}`}>
                        {c.proveedores?.nombre ?? "—"}
                        {c.elegida && <span className="ml-1.5 text-xs text-green-700">✓ elegida</span>}
                        {!c.elegida && c.id === masBarato && (
                          <span className="ml-1.5 text-xs text-slate-400">más barato</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{c.marca ?? "—"}</td>
                      <td className="px-3 py-2 text-right font-mono">{moneda(c.precio_unitario)}</td>
                      <td className="px-3 py-2 text-right">{c.cantidad ?? "—"}</td>
                      <td className="px-3 py-2 text-right font-mono">{moneda(c.costo_envio)}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">{moneda(c.precio_total)}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {c.plazo_pago_dias === null ? "—" : `${c.plazo_pago_dias} días`}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{c.disponibilidad ?? "—"}</td>
                      <td className={`px-3 py-2 ${vencido ? "text-red-600" : "text-slate-600"}`}>
                        {fecha(c.precio_hasta)}
                        {vencido && <span className="ml-1 text-xs">vencido</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {puedeElegir && (
                          <button
                            onClick={() => elegir(c)}
                            disabled={eligiendo !== null}
                            className="rounded-lg bg-[var(--primary)] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
                          >
                            {eligiendo === c.id ? "Aprobando…" : "Aprobar con este"}
                          </button>
                        )}
                        {!puedeElegir && puedeCargar && (
                          <button
                            onClick={() => borrar(c)}
                            className="text-xs text-slate-400 hover:text-red-600"
                          >
                            Borrar
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {congelada && cotizaciones.length > 0 && (
          <p className="text-xs text-slate-400">
            La comparativa quedó congelada al aprobarse la compra.
          </p>
        )}
      </div>

      {selector && (
        <SelectorComparativa
          requerimientoId={r.id}
          onListo={(mensaje) => refrescar(mensaje)}
          onCerrar={() => setSelector(false)}
        />
      )}
    </section>
  );
}
```

- [ ] **Step 3: Montarlo en la ficha**

En `page.tsx`, pasar el usuario para saber si es el asignado. Después de `const permisos = ...`:

```tsx
  const esAsignado = requerimiento.compra_asignada_a === user.id;
```

Y agregarlo al JSX: `esAsignado={esAsignado}`.

En `RequerimientoDetalle.tsx`:
1. Agregar `esAsignado: boolean;` a las props y al destructuring.
2. Importar el componente: `import Comparativa from "./Comparativa";`
3. Reemplazar el bloque `{/* Comparativa */}` completo (líneas 224-257, la tabla de sólo lectura) por:

```tsx
          <Comparativa
            requerimiento={r}
            cotizaciones={cotizaciones}
            proveedores={proveedores}
            puedeEditar={puedeEditar}
            esAsignado={esAsignado}
          />
```

- [ ] **Step 4: Verificar que compila y que el build pasa**

Run: `npx tsc --noEmit && npm run build`
Expected: sin errores. Si `tsc` se queja de `c.plazo_entrega` o `c.condiciones`, es que quedó una referencia a los campos viejos: no existen más.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/compras/requerimientos/[id]"
git commit -m "feat(compras): la comparativa se carga y se resuelve en la app"
```

---

## Tarea 13: Verificar en el navegador

- [ ] **Step 1: Levantar la app**

Usar la herramienta de preview (no `npm run dev` por consola) con la configuración de `.claude/launch.json`; si no existe, crearla con `npm run dev` y puerto 3000.

- [ ] **Step 2: Recorrer el circuito**

Con un RI aprobado:
1. La sección "Comparativa de proveedores" aparece en la ficha.
2. "Elegir comparativa de Drive" avisa que la carpeta no está configurada (en local no hay credenciales de Google) — eso es lo correcto, no un error.
3. "Cargar presupuesto" guarda y la fila aparece en la tabla con el total calculado.
4. Cargar un segundo presupuesto más barato: queda arriba, marcado "más barato".
5. Con `compra_asignada_a` puesto en el usuario y el RI en `PARA_COMPRAR`, aparece "Aprobar con este" y el estado pasa a "Compra aprobada".
6. Después de aprobar, ya no se puede cargar ni borrar.

- [ ] **Step 3: Revisar consola y red**

Sin errores de consola. Los `PATCH`/`POST` devuelven 200/201.

- [ ] **Step 4: Sacar una captura de la comparativa cargada**

Es el insumo para la conversación sobre cómo mostrarla.

---

## Tarea 14: Documentación y variables

**Files:**
- Modify: `.env.example`, `docs/VARIABLES-VERCEL.md`, `docs/COMPRAS.md`, `docs/COMPRAS-SINCRONIZACION.md`

- [ ] **Step 1: La variable nueva**

En `.env.example`, después de `GOOGLE_SERVICE_ACCOUNT_JSON`:

```
# Carpeta de Drive donde viven las planillas de comparativa (esta en la URL de
# la carpeta). La cuenta de servicio necesita permiso de EDITOR: la app no solo
# lee, tambien agrega filas y marca la eleccion.
GOOGLE_DRIVE_COMPARATIVAS_FOLDER_ID=
```

Agregarla también a `docs/VARIABLES-VERCEL.md`, con la misma explicación.

- [ ] **Step 2: Cómo funciona**

En `docs/COMPRAS.md`, en la tabla de pantallas, aclarar que la ficha del RI incluye la comparativa editable. Y una sección corta sobre el circuito: elegir un presupuesto es aprobar la compra, y al aprobar se congela.

En `docs/COMPRAS-SINCRONIZACION.md`, una sección nueva: la carpeta de comparativas, la regla de la columna A, que las filas nuevas llevan la fórmula corregida con el envío, y que borrar en la app vacía la fila en vez de eliminarla para no correr las de abajo.

- [ ] **Step 3: Commit**

```bash
git add .env.example docs/
git commit -m "docs(compras): la comparativa y la carpeta de Drive"
```

---

## Después de este plan

1. **Cómo se muestra la comparativa** — con la captura de la Tarea 13, proponer alternativas al usuario y ajustar.
2. **Plan del importador de históricos** — recorrer la carpeta y cargar cada planilla en su RI por la columna A, con `--dry-run`.
3. **Pasos manuales del usuario** — compartir la carpeta con la cuenta de servicio como editor, y cargar `GOOGLE_DRIVE_COMPARATIVAS_FOLDER_ID` en Vercel.
