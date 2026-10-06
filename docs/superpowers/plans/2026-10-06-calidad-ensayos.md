# Ensayos de calidad — plan de implementación

> **Para quien lo ejecute:** las tareas van en orden y cada una termina en un
> commit. Los pasos usan `- [ ]` para ir tildando.

**Objetivo:** una pestaña **Ensayos** dentro de Calidad, donde se cargan las
muestras del laboratorio —humedad, peso volumétrico, cal útil vial y
granulometría— guardando **las mediciones y ningún porcentaje**, con límites por
producto que nacen vacíos.

**Arquitectura:** cuatro tablas (`calidad_ensayos_productos`, `_muestras`,
`_retenidos`, `_limites`); las cuentas viven en funciones puras de
`lib/calidad/ensayos/` con tests de vitest; las rutas de `app/api/calidad/ensayos/`
validan y escriben; cinco pantallas responsive en `app/(app)/calidad/ensayos/`.
**No hay espejo a Google Sheets**: es el primer frente de Calidad sin planilla.

**Stack:** Next.js 16 (App Router, Server Components), Supabase (PostgREST +
RLS), TypeScript, vitest, Tailwind.

**Diseño acordado:** [docs/superpowers/specs/2026-10-06-calidad-ensayos-design.md](../specs/2026-10-06-calidad-ensayos-design.md)

---

## Lo que hay que saber antes de empezar

- **Las migraciones las corre una persona**, a mano en el editor SQL de
  Supabase. Un agente puede escribirla; no puede correrla. La Tarea 1 termina
  avisando y el resto del plan sigue sin ella — lo único que no se puede hacer
  hasta que corra es probar contra la base real.
- **Nunca `git add -A`.** Suele haber otra sesión en el mismo árbol. Cada commit
  de este plan usa `git commit --only <rutas> -F -`, que arma su propio árbol y
  deja intacto lo que la otra sesión tenga staged.
- **Un desplegable se escribe `<Select>`**, de `components/Select.tsx`, nunca
  `<select>` nativo.
- **`traerTodo()`** de `lib/core/paginado.ts` en toda consulta a una tabla que
  pueda crecer: PostgREST corta en 1000 filas y no avisa.
- **El `select()` va literal**, no armado en una variable, o se pierde la
  inferencia de tipos de Supabase.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/<ts>_calidad_ensayos.sql` | Los dos tipos, las cuatro tablas, índices y RLS |
| `lib/calidad/ensayos/types.ts` | Tipos del frente. Sin lógica |
| `lib/calidad/ensayos/determinaciones.ts` | `humedad`, `pesoVolumetrico`, `calUtilVial` |
| `lib/calidad/ensayos/granulometria.ts` | Retenidos → porcentajes y acumulados |
| `lib/calidad/ensayos/limites.ts` | `limiteDe`, `fueraDeLimite`, `evaluarMuestra` |
| `lib/calidad/ensayos/consultas.ts` | Las lecturas a Supabase |
| `app/api/calidad/ensayos/productos/route.ts` | Alta y edición de productos (admin) |
| `app/api/calidad/ensayos/limites/route.ts` | Alta, edición y borrado de límites (admin) |
| `app/api/calidad/ensayos/muestras/route.ts` | Alta de muestra con sus retenidos |
| `app/api/calidad/ensayos/muestras/[id]/route.ts` | Corrección y borrado |
| `app/(app)/calidad/ensayos/page.tsx` + `EnsayosClient.tsx` | El listado |
| `app/(app)/calidad/ensayos/nueva/page.tsx` + `CargarClient.tsx` | La carga |
| `app/(app)/calidad/ensayos/[id]/page.tsx` + `MuestraClient.tsx` | Ver y corregir |
| `app/(app)/calidad/ensayos/productos/page.tsx` + `ProductosClient.tsx` | La lista y sus mallas |
| `app/(app)/calidad/ensayos/limites/page.tsx` + `LimitesClient.tsx` | Los límites |
| `lib/core/nav.ts` | El tercer subgrupo del menú de Calidad |
| `docs/CALIDAD-ENSAYOS.md` | El documento del frente |

**Las unidades, dichas una vez y para todo el plan.** Se guardan gramos, ml,
centímetros cúbicos. **Se devuelven** porcentajes como número de 0 a 100
(`0,98` es 0,98%) y el peso volumétrico en g/l. Los límites se guardan en esa
misma unidad de salida, que es por qué se pueden comparar directo.

---

## Tarea 1: La migración

**Archivos:**
- Crear: `supabase/migrations/<timestamp>_calidad_ensayos.sql`

- [ ] **Paso 1: Crear el archivo con marca de tiempo**

```bash
npm run migracion "calidad ensayos"
```

No inventar los catorce dígitos a mano: el script los pone y evita el choque de
dos sesiones tomando el mismo número.

- [ ] **Paso 2: Escribir la migración**

El contenido completo va en el archivo que creó el script. Los puntos que no se
pueden cambiar sin romper el diseño:

1. **Los dos tipos se crean enteros en este mismo archivo.** El `55P04` es sólo
   para agregar un valor a un enum que ya existe.

```sql
create type calidad_ensayos_grupo as enum ('produccion', 'proceso');
create type calidad_ensayos_determinacion as enum
  ('humedad', 'peso_volumetrico', 'cal_util_vial', 'retenido', 'acumulado');
```

2. **`calidad_ensayos_productos`** con `mallas integer[] not null default '{}'`,
   `nombre text not null`, `grupo calidad_ensayos_grupo not null`,
   `orden integer not null default 0`, `activo boolean not null default true`, y
   `unique (nombre)`.

3. **`calidad_ensayos_muestras`** con `fecha date not null`,
   `producto_id uuid not null references calidad_ensayos_productos(id) on delete restrict`,
   `observaciones text`, y las siete columnas de medición, **todas `numeric` y
   todas nullable**:
   `humedad_p_recipiente`, `humedad_p_inicial`, `humedad_p_final`,
   `peso_vol_gramos`, `peso_vol_volumen_cc`, `cal_util_ml_acido`,
   `cal_util_peso_muestra_g`, `granulometria_peso_muestra_g`.
   Más `cargado_por`/`cargado_en`/`actualizado_por`/`actualizado_en`.

   **Sin `unique (fecha, producto_id)`** — y el comentario tiene que decir por
   qué, porque es lo primero que alguien va a querer agregar: 28 de las 29 fechas
   repetidas de la hoja `Cal` son dos muestras del mismo día, de verdad.

   Los CHECK que sí van, porque son imposibles y no improbables:
   `check (humedad_p_inicial is null or humedad_p_inicial > 0)`,
   `check (peso_vol_volumen_cc is null or peso_vol_volumen_cc > 0)`,
   `check (cal_util_peso_muestra_g is null or cal_util_peso_muestra_g > 0)`,
   `check (granulometria_peso_muestra_g is null or granulometria_peso_muestra_g > 0)`.

4. **`calidad_ensayos_retenidos`**: `muestra_id uuid not null references
   calidad_ensayos_muestras(id) on delete cascade`, `malla integer not null
   check (malla > 0)`, `retenido_g numeric not null check (retenido_g >= 0)`,
   `unique (muestra_id, malla)`.

   El `on delete cascade` es a propósito: un retenido sin muestra no es nada.

5. **`calidad_ensayos_limites`**: `producto_id`, `determinacion`,
   `malla integer`, `minimo numeric`, `maximo numeric`, con
   `unique (producto_id, determinacion, malla)` y dos CHECK:

```sql
  -- La malla es de la granulometría y de nada más.
  constraint calidad_ensayos_limites_malla check (
    (determinacion in ('retenido', 'acumulado') and malla is not null)
    or (determinacion not in ('retenido', 'acumulado') and malla is null)
  ),
  -- Un límite sin ninguno de los dos extremos no es un límite.
  constraint calidad_ensayos_limites_algo check (minimo is not null or maximo is not null)
```

   **Ojo con el `unique` y los NULL.** En Postgres dos filas con `malla` nula no
   chocan entre sí, así que el único no protege a `humedad`, `peso_volumetrico`
   ni `cal_util_vial`. Va además un índice único parcial:

```sql
create unique index calidad_ensayos_limites_sin_malla
  on public.calidad_ensayos_limites (producto_id, determinacion)
  where malla is null;
```

   Y queda dicho en el comentario que **ese índice parcial no sirve como destino
   de un `ON CONFLICT`** — es una de las ocho trampas del README de migraciones.
   Por eso las rutas de límites hacen `select` y después `insert` o `update`, y
   no un upsert.

6. **Índices**: `calidad_ensayos_muestras (fecha)`,
   `calidad_ensayos_muestras (producto_id, fecha)`,
   `calidad_ensayos_retenidos (muestra_id)`.

7. **RLS**, calcada de `20260916090409_calidad_schema.sql`:

```sql
alter table public.calidad_ensayos_productos  enable row level security;
alter table public.calidad_ensayos_muestras   enable row level security;
alter table public.calidad_ensayos_retenidos  enable row level security;
alter table public.calidad_ensayos_limites    enable row level security;

create policy calidad_ensayos_productos_leer on public.calidad_ensayos_productos
  for select using (tiene_acceso_calidad());
create policy calidad_ensayos_productos_escribir on public.calidad_ensayos_productos
  for all using (es_admin_calidad()) with check (es_admin_calidad());

create policy calidad_ensayos_muestras_leer on public.calidad_ensayos_muestras
  for select using (tiene_acceso_calidad());
create policy calidad_ensayos_muestras_escribir on public.calidad_ensayos_muestras
  for all using (puede_editar_calidad()) with check (puede_editar_calidad());

create policy calidad_ensayos_retenidos_leer on public.calidad_ensayos_retenidos
  for select using (tiene_acceso_calidad());
create policy calidad_ensayos_retenidos_escribir on public.calidad_ensayos_retenidos
  for all using (puede_editar_calidad()) with check (puede_editar_calidad());

create policy calidad_ensayos_limites_leer on public.calidad_ensayos_limites
  for select using (tiene_acceso_calidad());
create policy calidad_ensayos_limites_escribir on public.calidad_ensayos_limites
  for all using (es_admin_calidad()) with check (es_admin_calidad());
```

8. **La siembra de los productos**, al final del mismo archivo, con los ocho de
   producción y los diez de proceso que salieron del Excel. Las mallas de los
   ocho son las que usa cada hoja; las de proceso quedan en `'{}'` porque las
   decide calidad.

```sql
insert into public.calidad_ensayos_productos (nombre, grupo, orden, mallas) values
  ('Filler 1',             'produccion',  1, '{50,100,200,325}'),
  ('Filler 2',             'produccion',  2, '{50,100,200,325}'),
  ('Cal',                  'produccion',  3, '{50,100,200,325}'),
  ('Calcio 0-1',           'produccion',  4, '{6,7,10,12,20,50,100,200}'),
  ('Calcio 0-2',           'produccion',  5, '{6,7,10,12,20,50,100,200}'),
  ('Calcio 1-2',           'produccion',  6, '{6,7,10,12,20,50,100,200}'),
  ('Despacho a Emapi',     'produccion',  7, '{50,100,200,325}'),
  ('Despacho a Kartonsec', 'produccion',  8, '{50,100,200,325}'),
  ('Caliza galpón',             'proceso', 20, '{}'),
  ('Arena dolomita P1',         'proceso', 21, '{}'),
  ('Arena caliza P3 limpia',    'proceso', 22, '{}'),
  ('Arena caliza P3 descarte',  'proceso', 23, '{}'),
  ('Acopio',                    'proceso', 24, '{}'),
  ('Chocolata galpón',          'proceso', 25, '{}'),
  ('Chocolata 0-2',             'proceso', 26, '{}'),
  ('Dolomita 0-2',              'proceso', 27, '{}'),
  ('Dolomita 6-20 P1',          'proceso', 28, '{}'),
  ('P3 chocolata',              'proceso', 29, '{}');
```

- [ ] **Paso 3: Commit**

```bash
git commit --only supabase/migrations/<archivo>.sql -F - <<'EOF'
feat(calidad): las cuatro tablas de los ensayos de laboratorio
EOF
```

- [ ] **Paso 4: Avisarle al usuario y seguir**

Decirle que la migración está escrita y que la tiene que correr a mano en el
editor SQL de Supabase. **No esperar**: las tareas 2 a 5 son funciones puras y no
tocan la base.

---

## Tarea 2: Los tipos

**Archivos:**
- Crear: `lib/calidad/ensayos/types.ts`

- [ ] **Paso 1: Escribir el archivo**

```ts
/** Los tipos del frente de ensayos. Sin lógica: la lógica vive en los otros archivos. */

export type GrupoDeProducto = "produccion" | "proceso";

export type Determinacion =
  | "humedad"
  | "peso_volumetrico"
  | "cal_util_vial"
  | "retenido"
  | "acumulado";

export interface ProductoDeEnsayo {
  id: string;
  nombre: string;
  grupo: GrupoDeProducto;
  orden: number;
  /** El juego habitual de tamices que la pantalla de carga propone. */
  mallas: number[];
  activo: boolean;
}

/**
 * Una muestra: producto y fecha, y las cuatro determinaciones como columnas
 * opcionales.
 *
 * **No hay un solo porcentaje acá.** Se guardan gramos, ml y centímetros
 * cúbicos; la humedad, los retenidos, los acumulados y el g/l se despejan al
 * leer. Es la corrección directa de lo que medimos en el Excel, donde la misma
 * columna estaba en dos escalas y la única señal era el formato de la celda.
 */
export interface Muestra {
  id: string;
  fecha: string;
  producto_id: string;
  observaciones: string | null;
  humedad_p_recipiente: number | null;
  humedad_p_inicial: number | null;
  humedad_p_final: number | null;
  peso_vol_gramos: number | null;
  peso_vol_volumen_cc: number | null;
  cal_util_ml_acido: number | null;
  cal_util_peso_muestra_g: number | null;
  granulometria_peso_muestra_g: number | null;
  cargado_por: string | null;
  cargado_en: string;
  actualizado_por: string | null;
  actualizado_en: string | null;
}

export interface Retenido {
  muestra_id: string;
  malla: number;
  retenido_g: number;
}

export interface Limite {
  id: string;
  producto_id: string;
  determinacion: Determinacion;
  /** Sólo para `retenido` y `acumulado`. */
  malla: number | null;
  minimo: number | null;
  maximo: number | null;
}

/** De qué lado del límite se fue. */
export type LadoDelDesvio = "alto" | "bajo";

/**
 * El resultado de una determinación.
 *
 * `valor` en null es "no se puede calcular" —falta un dato, o la cuenta divide
 * por cero—. `problema` acompaña al valor en vez de reemplazarlo: una humedad
 * negativa **se muestra**, con el aviso al lado. Recortarla escondería justo lo
 * que hay que corregir.
 */
export interface ValorEvaluado {
  valor: number | null;
  problema?: string;
  fuera?: LadoDelDesvio;
}
```

- [ ] **Paso 2: Verificar que compila**

```bash
npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Paso 3: Commit**

```bash
git commit --only lib/calidad/ensayos/types.ts -F - <<'EOF'
feat(calidad): los tipos del frente de ensayos
EOF
```

---

## Tarea 3: Humedad, peso volumétrico y cal útil vial

**Archivos:**
- Crear: `lib/calidad/ensayos/determinaciones.ts`
- Test: `lib/calidad/ensayos/determinaciones.test.ts`

- [ ] **Paso 1: Escribir los tests que fallan**

```ts
import { describe, expect, it } from "vitest";
import { calUtilVial, humedad, pesoVolumetrico } from "./determinaciones";

describe("humedad", () => {
  /**
   * El caso real del 25/09/2026 en la hoja `Otros`: dolomita, los tres pesos
   * tipeados y la fórmula del Excel dando 0,0091 — o sea 0,91%.
   */
  it("es (inicial − final) / (inicial − recipiente), en por ciento", () => {
    const r = humedad({ recipiente: 417.09, inicial: 539.25, final: 538.14 });
    expect(r.valor).toBe(0.91);
    expect(r.problema).toBeUndefined();
  });

  it("sin los tres pesos no hay humedad, y tampoco hay problema", () => {
    expect(humedad({ recipiente: 417.09, inicial: null, final: 538.14 }).valor).toBeNull();
    expect(humedad({ recipiente: null, inicial: null, final: null }).problema).toBeUndefined();
  });

  /**
   * El `#DIV/0!` real de `Despacho a Kartonsec` fila 27: el peso inicial igual
   * al del recipiente. En el Excel quedó el error escrito en la celda; acá se
   * dice lo que pasó.
   */
  it("avisa cuando el inicial es igual al recipiente, en vez de dividir por cero", () => {
    const r = humedad({ recipiente: 433.2, inicial: 433.2, final: 430 });
    expect(r.valor).toBeNull();
    expect(r.problema).toContain("recipiente");
  });

  /** La muestra no puede pesar más seca que húmeda: es tipeo o balanza. */
  it("muestra la humedad negativa con el aviso, no la recorta a cero", () => {
    const r = humedad({ recipiente: 400, inicial: 500, final: 510 });
    expect(r.valor).toBe(-10);
    expect(r.problema).toContain("final");
  });
});

describe("pesoVolumetrico", () => {
  /** La fila 19 de `Despacho a Kartonsec`, la única donde quedó la fórmula escrita. */
  it("son los gramos llevados a un litro", () => {
    expect(pesoVolumetrico({ gramos: 299.668, volumenCc: 330 }).valor).toBe(908.08);
  });

  it("sin gramos no hay peso volumétrico", () => {
    expect(pesoVolumetrico({ gramos: null, volumenCc: 330 }).valor).toBeNull();
  });

  /**
   * El recipiente es un dato de la muestra y no una constante escondida: en el
   * Excel conviven 330 cc y 333,3 cc, que es un 1% de diferencia sistemática.
   */
  it("avisa si el volumen falta o no es positivo, en vez de suponer 330", () => {
    expect(pesoVolumetrico({ gramos: 300, volumenCc: 0 }).valor).toBeNull();
    expect(pesoVolumetrico({ gramos: 300, volumenCc: 0 }).problema).toContain("recipiente");
  });
});

describe("calUtilVial", () => {
  /** La única fila del Excel con la fórmula escrita: 41 ml sobre 3 g. */
  it("es ml × 0,037 / peso de muestra, en por ciento", () => {
    expect(calUtilVial({ mlAcido: 41, pesoMuestraG: 3 }).valor).toBe(50.57);
  });

  it("sin ml no hay determinación", () => {
    expect(calUtilVial({ mlAcido: null, pesoMuestraG: 3 }).valor).toBeNull();
  });

  it("avisa si el peso de muestra falta o es cero", () => {
    const r = calUtilVial({ mlAcido: 41, pesoMuestraG: null });
    expect(r.valor).toBeNull();
    expect(r.problema).toContain("peso");
  });
});
```

- [ ] **Paso 2: Correr y ver que falla**

```bash
npx vitest run lib/calidad/ensayos/determinaciones.test.ts
```

Esperado: falla con `Failed to resolve import "./determinaciones"`.

- [ ] **Paso 3: Escribir la implementación**

```ts
import type { ValorEvaluado } from "./types";

/**
 * Las tres determinaciones que salen de una cuenta de una línea.
 *
 * **Todas devuelven el número como se lee**: por ciento de 0 a 100 para la
 * humedad y la cal útil vial, g/l para el peso volumétrico. Es la misma unidad
 * en que se guardan los límites, y por eso se pueden comparar sin convertir
 * nada — que es exactamente el paso donde el Excel se rompió.
 */

/** Dos decimales. Más que eso es precisión que la balanza no tiene. */
function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

function esNumero(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export function humedad(pesos: {
  recipiente: number | null;
  inicial: number | null;
  final: number | null;
}): ValorEvaluado {
  const { recipiente, inicial, final } = pesos;
  if (!esNumero(recipiente) || !esNumero(inicial) || !esNumero(final)) {
    return { valor: null };
  }

  const seco = inicial - recipiente;
  if (seco <= 0) {
    return {
      valor: null,
      problema: "El peso inicial no supera al del recipiente: la muestra pesa cero.",
    };
  }

  const valor = redondear(((inicial - final) / seco) * 100);
  // No se recorta: una humedad negativa es un error de carga o de balanza, y es
  // justo lo que hay que ver.
  return final > inicial
    ? { valor, problema: "El peso final es mayor que el inicial: la muestra ganó peso." }
    : { valor };
}

export function pesoVolumetrico(medicion: {
  gramos: number | null;
  volumenCc: number | null;
}): ValorEvaluado {
  const { gramos, volumenCc } = medicion;
  if (!esNumero(gramos)) return { valor: null };
  if (!esNumero(volumenCc) || volumenCc <= 0) {
    return { valor: null, problema: "Falta el volumen del recipiente." };
  }
  return { valor: redondear((gramos * 1000) / volumenCc) };
}

/** Gramos de cal útil por mililitro de ácido. Es la constante del método. */
const CAL_UTIL_POR_ML = 0.037;

export function calUtilVial(titulacion: {
  mlAcido: number | null;
  pesoMuestraG: number | null;
}): ValorEvaluado {
  const { mlAcido, pesoMuestraG } = titulacion;
  if (!esNumero(mlAcido)) return { valor: null };
  if (!esNumero(pesoMuestraG) || pesoMuestraG <= 0) {
    return { valor: null, problema: "Falta el peso de la muestra titulada." };
  }
  return { valor: redondear(((mlAcido * CAL_UTIL_POR_ML) / pesoMuestraG) * 100) };
}
```

- [ ] **Paso 4: Correr y ver que pasa**

```bash
npx vitest run lib/calidad/ensayos/determinaciones.test.ts
```

Esperado: 10 tests en verde.

- [ ] **Paso 5: Commit**

```bash
git commit --only lib/calidad/ensayos/determinaciones.ts lib/calidad/ensayos/determinaciones.test.ts -F - <<'EOF'
feat(calidad): humedad, peso volumetrico y cal util vial se despejan
EOF
```

---

## Tarea 4: La granulometría y sus acumulados

**Archivos:**
- Crear: `lib/calidad/ensayos/granulometria.ts`
- Test: `lib/calidad/ensayos/granulometria.test.ts`

- [ ] **Paso 1: Escribir los tests que fallan**

```ts
import { describe, expect, it } from "vitest";
import { granulometria } from "./granulometria";

describe("granulometria", () => {
  /**
   * La fila 150 de `Filler 1` (14/07/2026), que en el Excel cierra exacta:
   * 0 + 2,5 + 16,6 = 19,1 y 19,1 + 18,8 = 37,9. Reconstruida en gramos sobre
   * una muestra de 100 g, que es lo que la vuelve comprobable.
   */
  it("acumula de mayor a menor abertura", () => {
    const r = granulometria({
      pesoMuestraG: 100,
      retenidos: [
        { malla: 325, retenido_g: 18.8 },
        { malla: 50, retenido_g: 0 },
        { malla: 200, retenido_g: 16.6 },
        { malla: 100, retenido_g: 2.5 },
      ],
    });

    expect(r.filas.map((f) => f.malla)).toEqual([50, 100, 200, 325]);
    expect(r.filas.map((f) => f.retenido.valor)).toEqual([0, 2.5, 16.6, 18.8]);
    expect(r.filas.map((f) => f.acumulado.valor)).toEqual([0, 2.5, 19.1, 37.9]);
    expect(r.problema).toBeUndefined();
  });

  /**
   * El acumulado deja de ser algo que alguien pueda tipear distinto. En el
   * Excel no cerraba en 32 filas; acá no hay forma de que no cierre.
   */
  it("el acumulado de la última malla es la suma de todo lo retenido", () => {
    const r = granulometria({
      pesoMuestraG: 20,
      retenidos: [
        { malla: 10, retenido_g: 1 },
        { malla: 20, retenido_g: 2 },
        { malla: 50, retenido_g: 3 },
      ],
    });
    expect(r.filas.at(-1)?.acumulado.valor).toBe(30);
  });

  it("sin peso de muestra no hay granulometría", () => {
    const r = granulometria({ pesoMuestraG: null, retenidos: [{ malla: 50, retenido_g: 1 }] });
    expect(r.filas).toEqual([]);
    expect(r.problema).toContain("peso");
  });

  it("sin retenidos no hay filas y tampoco hay problema", () => {
    expect(granulometria({ pesoMuestraG: 20, retenidos: [] })).toEqual({ filas: [] });
  });

  /**
   * Más retenido que muestra es imposible. Se muestra igual, con el aviso: es
   * la misma regla que la producción negativa en Producción.
   */
  it("avisa cuando lo retenido supera la muestra, y muestra las filas igual", () => {
    const r = granulometria({
      pesoMuestraG: 20,
      retenidos: [
        { malla: 50, retenido_g: 15 },
        { malla: 100, retenido_g: 10 },
      ],
    });
    expect(r.filas).toHaveLength(2);
    expect(r.filas.at(-1)?.acumulado.valor).toBe(125);
    expect(r.problema).toContain("supera");
  });
});
```

- [ ] **Paso 2: Correr y ver que falla**

```bash
npx vitest run lib/calidad/ensayos/granulometria.test.ts
```

Esperado: falla con `Failed to resolve import "./granulometria"`.

- [ ] **Paso 3: Escribir la implementación**

```ts
import type { ValorEvaluado } from "./types";

/**
 * Los retenidos de una muestra, en porcentaje, y el acumulado de cada malla.
 *
 * **El acumulado no se guarda ni se tipea: se despeja.** En el Excel era una
 * columna que alguien escribía, y no cerraba contra sus propias partes en 32
 * filas. Acá no puede no cerrar, porque no existe como dato.
 *
 * El orden es por número de malla creciente, que es abertura decreciente: el
 * acumulado a #200 es todo lo que no pasó por #200, o sea la suma de #50, #100
 * y #200. Comprobado contra la fila 150 de `Filler 1`.
 */

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface FilaDeGranulometria {
  malla: number;
  retenido: ValorEvaluado;
  acumulado: ValorEvaluado;
}

export interface Granulometria {
  filas: FilaDeGranulometria[];
  problema?: string;
}

export function granulometria(ensayo: {
  pesoMuestraG: number | null;
  retenidos: { malla: number; retenido_g: number }[];
}): Granulometria {
  const { pesoMuestraG, retenidos } = ensayo;
  if (retenidos.length === 0) return { filas: [] };

  if (typeof pesoMuestraG !== "number" || !Number.isFinite(pesoMuestraG) || pesoMuestraG <= 0) {
    return { filas: [], problema: "Falta el peso de la muestra tamizada." };
  }

  const ordenados = [...retenidos].sort((a, b) => a.malla - b.malla);

  let corrido = 0;
  const filas = ordenados.map((r) => {
    corrido += r.retenido_g;
    return {
      malla: r.malla,
      retenido: { valor: redondear((r.retenido_g / pesoMuestraG) * 100) },
      acumulado: { valor: redondear((corrido / pesoMuestraG) * 100) },
    };
  });

  // No se recorta a 100: lo retenido no puede superar a la muestra, y verlo es
  // la única forma de corregirlo.
  return corrido > pesoMuestraG
    ? { filas, problema: "Lo retenido supera el peso de la muestra." }
    : { filas };
}
```

- [ ] **Paso 4: Correr y ver que pasa**

```bash
npx vitest run lib/calidad/ensayos/granulometria.test.ts
```

Esperado: 5 tests en verde.

- [ ] **Paso 5: Commit**

```bash
git commit --only lib/calidad/ensayos/granulometria.ts lib/calidad/ensayos/granulometria.test.ts -F - <<'EOF'
feat(calidad): el acumulado se despeja y por eso no puede no cerrar
EOF
```

---

## Tarea 5: Los límites y la muestra evaluada

**Archivos:**
- Crear: `lib/calidad/ensayos/limites.ts`
- Test: `lib/calidad/ensayos/limites.test.ts`

- [ ] **Paso 1: Escribir los tests que fallan**

```ts
import { describe, expect, it } from "vitest";
import { evaluarMuestra, fueraDeLimite, limiteDe } from "./limites";
import type { Limite, Muestra } from "./types";

const PRODUCTO = "p1";

function muestraVacia(): Muestra {
  return {
    id: "m1",
    fecha: "2026-10-06",
    producto_id: PRODUCTO,
    observaciones: null,
    humedad_p_recipiente: null,
    humedad_p_inicial: null,
    humedad_p_final: null,
    peso_vol_gramos: null,
    peso_vol_volumen_cc: null,
    cal_util_ml_acido: null,
    cal_util_peso_muestra_g: null,
    granulometria_peso_muestra_g: null,
    cargado_por: null,
    cargado_en: "2026-10-06T10:00:00Z",
    actualizado_por: null,
    actualizado_en: null,
  };
}

function limite(parcial: Partial<Limite>): Limite {
  return {
    id: "l1",
    producto_id: PRODUCTO,
    determinacion: "humedad",
    malla: null,
    minimo: null,
    maximo: null,
    ...parcial,
  };
}

describe("fueraDeLimite", () => {
  it("sin límite cargado no dice nada: es el estado en que nace el módulo", () => {
    expect(fueraDeLimite(99, undefined)).toBeUndefined();
  });

  it("dentro no dice nada", () => {
    expect(fueraDeLimite(2, limite({ minimo: 1, maximo: 3 }))).toBeUndefined();
  });

  it("los extremos están adentro", () => {
    expect(fueraDeLimite(1, limite({ minimo: 1, maximo: 3 }))).toBeUndefined();
    expect(fueraDeLimite(3, limite({ minimo: 1, maximo: 3 }))).toBeUndefined();
  });

  it("marca de qué lado se fue", () => {
    expect(fueraDeLimite(3.1, limite({ minimo: 1, maximo: 3 }))).toBe("alto");
    expect(fueraDeLimite(0.9, limite({ minimo: 1, maximo: 3 }))).toBe("bajo");
  });

  it("un límite con un solo extremo controla sólo ese lado", () => {
    expect(fueraDeLimite(0.1, limite({ maximo: 3 }))).toBeUndefined();
    expect(fueraDeLimite(9, limite({ maximo: 3 }))).toBe("alto");
  });

  it("un valor que no se pudo calcular no está fuera de nada", () => {
    expect(fueraDeLimite(null, limite({ maximo: 3 }))).toBeUndefined();
  });
});

describe("limiteDe", () => {
  const limites = [
    limite({ id: "a", determinacion: "humedad", maximo: 1.5 }),
    limite({ id: "b", determinacion: "retenido", malla: 100, maximo: 6 }),
    limite({ id: "c", determinacion: "retenido", malla: 200, maximo: 25 }),
  ];

  it("encuentra el de una determinación sin malla", () => {
    expect(limiteDe(limites, "humedad", null)?.id).toBe("a");
  });

  it("la malla es parte de la identidad del límite", () => {
    expect(limiteDe(limites, "retenido", 200)?.id).toBe("c");
    expect(limiteDe(limites, "retenido", 325)).toBeUndefined();
  });
});

describe("evaluarMuestra", () => {
  it("con la tabla de límites vacía calcula todo y no marca nada", () => {
    const m = { ...muestraVacia(), peso_vol_gramos: 299.668, peso_vol_volumen_cc: 330 };
    const r = evaluarMuestra(m, [], []);
    expect(r.pesoVolumetrico.valor).toBe(908.08);
    expect(r.pesoVolumetrico.fuera).toBeUndefined();
    expect(r.hayFueraDeLimite).toBe(false);
  });

  it("marca la humedad fuera de límite y lo cuenta en la muestra", () => {
    const m = {
      ...muestraVacia(),
      humedad_p_recipiente: 400,
      humedad_p_inicial: 500,
      humedad_p_final: 497,
    };
    const r = evaluarMuestra(m, [], [limite({ determinacion: "humedad", maximo: 1.5 })]);
    expect(r.humedad.valor).toBe(3);
    expect(r.humedad.fuera).toBe("alto");
    expect(r.hayFueraDeLimite).toBe(true);
  });

  /** El `Ret #100 = 15,3%` de la fila 184 de `Filler 1`, que hoy entra sin una palabra. */
  it("marca el retenido de una malla contra su propio límite", () => {
    const m = { ...muestraVacia(), granulometria_peso_muestra_g: 100 };
    const retenidos = [
      { muestra_id: "m1", malla: 100, retenido_g: 15.3 },
      { muestra_id: "m1", malla: 200, retenido_g: 31.4 },
    ];
    const limites = [limite({ determinacion: "retenido", malla: 100, maximo: 6 })];

    const r = evaluarMuestra(m, retenidos, limites);
    expect(r.granulometria.filas[0].retenido.fuera).toBe("alto");
    expect(r.granulometria.filas[1].retenido.fuera).toBeUndefined();
    expect(r.hayFueraDeLimite).toBe(true);
  });

  it("el acumulado tiene su propio límite, distinto del retenido", () => {
    const m = { ...muestraVacia(), granulometria_peso_muestra_g: 100 };
    const retenidos = [{ muestra_id: "m1", malla: 200, retenido_g: 40 }];
    const limites = [limite({ determinacion: "acumulado", malla: 200, maximo: 30 })];

    const r = evaluarMuestra(m, retenidos, limites);
    expect(r.granulometria.filas[0].retenido.fuera).toBeUndefined();
    expect(r.granulometria.filas[0].acumulado.fuera).toBe("alto");
  });

  it("un problema de cálculo no se pierde al evaluar los límites", () => {
    const m = { ...muestraVacia(), humedad_p_recipiente: 400, humedad_p_inicial: 400, humedad_p_final: 399 };
    const r = evaluarMuestra(m, [], [limite({ determinacion: "humedad", maximo: 1.5 })]);
    expect(r.humedad.valor).toBeNull();
    expect(r.humedad.problema).toContain("recipiente");
    expect(r.hayFueraDeLimite).toBe(false);
  });
});
```

- [ ] **Paso 2: Correr y ver que falla**

```bash
npx vitest run lib/calidad/ensayos/limites.test.ts
```

Esperado: falla con `Failed to resolve import "./limites"`.

- [ ] **Paso 3: Escribir la implementación**

```ts
import { calUtilVial, humedad, pesoVolumetrico } from "./determinaciones";
import { granulometria, type FilaDeGranulometria } from "./granulometria";
import type { Determinacion, LadoDelDesvio, Limite, Muestra, Retenido, ValorEvaluado } from "./types";

/**
 * Los límites y la muestra ya evaluada.
 *
 * **La tabla de límites nace vacía y mientras lo esté nada se marca.** Es la
 * misma decisión que los renglones del parte en Producción: la pieza existe y
 * el módulo ya la usa, así que el día que calidad decida los valores no hay que
 * migrar ni volver a tocar las pantallas.
 */

export function limiteDe(
  limites: Limite[],
  determinacion: Determinacion,
  malla: number | null
): Limite | undefined {
  return limites.find((l) => l.determinacion === determinacion && l.malla === malla);
}

export function fueraDeLimite(
  valor: number | null,
  limite: Limite | undefined
): LadoDelDesvio | undefined {
  if (valor === null || !limite) return undefined;
  if (limite.maximo !== null && valor > limite.maximo) return "alto";
  if (limite.minimo !== null && valor < limite.minimo) return "bajo";
  return undefined;
}

function conLimite(
  evaluado: ValorEvaluado,
  limites: Limite[],
  determinacion: Determinacion,
  malla: number | null
): ValorEvaluado {
  const fuera = fueraDeLimite(evaluado.valor, limiteDe(limites, determinacion, malla));
  return fuera ? { ...evaluado, fuera } : evaluado;
}

export interface MuestraEvaluada {
  humedad: ValorEvaluado;
  pesoVolumetrico: ValorEvaluado;
  calUtilVial: ValorEvaluado;
  granulometria: { filas: FilaDeGranulometria[]; problema?: string };
  hayFueraDeLimite: boolean;
}

export function evaluarMuestra(
  muestra: Muestra,
  retenidos: Retenido[],
  limites: Limite[]
): MuestraEvaluada {
  const delProducto = limites.filter((l) => l.producto_id === muestra.producto_id);

  const h = conLimite(
    humedad({
      recipiente: muestra.humedad_p_recipiente,
      inicial: muestra.humedad_p_inicial,
      final: muestra.humedad_p_final,
    }),
    delProducto,
    "humedad",
    null
  );

  const pv = conLimite(
    pesoVolumetrico({ gramos: muestra.peso_vol_gramos, volumenCc: muestra.peso_vol_volumen_cc }),
    delProducto,
    "peso_volumetrico",
    null
  );

  const cuv = conLimite(
    calUtilVial({
      mlAcido: muestra.cal_util_ml_acido,
      pesoMuestraG: muestra.cal_util_peso_muestra_g,
    }),
    delProducto,
    "cal_util_vial",
    null
  );

  const g = granulometria({
    pesoMuestraG: muestra.granulometria_peso_muestra_g,
    retenidos: retenidos.map((r) => ({ malla: r.malla, retenido_g: r.retenido_g })),
  });

  const filas = g.filas.map((f) => ({
    malla: f.malla,
    retenido: conLimite(f.retenido, delProducto, "retenido", f.malla),
    acumulado: conLimite(f.acumulado, delProducto, "acumulado", f.malla),
  }));

  const hayFueraDeLimite =
    [h, pv, cuv].some((v) => v.fuera !== undefined) ||
    filas.some((f) => f.retenido.fuera !== undefined || f.acumulado.fuera !== undefined);

  return {
    humedad: h,
    pesoVolumetrico: pv,
    calUtilVial: cuv,
    granulometria: { filas, problema: g.problema },
    hayFueraDeLimite,
  };
}
```

- [ ] **Paso 4: Correr y ver que pasa**

```bash
npx vitest run lib/calidad/ensayos/limites.test.ts
```

Esperado: 14 tests en verde.

- [ ] **Paso 5: Correr la suite entera, para no haber roto nada**

```bash
npx vitest run
```

- [ ] **Paso 6: Commit**

```bash
git commit --only lib/calidad/ensayos/limites.ts lib/calidad/ensayos/limites.test.ts -F - <<'EOF'
feat(calidad): los limites, que nacen vacios y por eso no avisan nada
EOF
```

---

## Tarea 6: Las consultas

**Archivos:**
- Crear: `lib/calidad/ensayos/consultas.ts`

- [ ] **Paso 1: Escribir el archivo**

Cuatro funciones, **todas con `traerTodo()`**, y el `select()` literal en cada
una (armarlo en una variable pierde la inferencia de tipos de Supabase):

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import type { Limite, Muestra, ProductoDeEnsayo, Retenido } from "./types";

/**
 * Las lecturas del frente de ensayos.
 *
 * **Todo con `traerTodo()`.** PostgREST corta en 1000 filas y no avisa. El
 * Excel que esto reemplaza trae 623 muestras de tres años y el laboratorio
 * carga entre una y tres por día: la tabla de muestras cruza el corte dentro
 * del primer año, y la de retenidos —hasta diez filas por muestra— en meses.
 */

export async function traerProductos(supabase: SupabaseClient): Promise<ProductoDeEnsayo[]> {
  return traerTodo<ProductoDeEnsayo>((desde, hasta) =>
    supabase
      .from("calidad_ensayos_productos")
      .select("id, nombre, grupo, orden, mallas, activo")
      .order("orden")
      .range(desde, hasta)
  );
}

export async function traerLimites(supabase: SupabaseClient): Promise<Limite[]> {
  return traerTodo<Limite>((desde, hasta) =>
    supabase
      .from("calidad_ensayos_limites")
      .select("id, producto_id, determinacion, malla, minimo, maximo")
      .order("determinacion")
      .order("malla")
      .range(desde, hasta)
  );
}

export async function traerMuestras(supabase: SupabaseClient, desdeFecha: string): Promise<Muestra[]> {
  return traerTodo<Muestra>((desde, hasta) =>
    supabase
      .from("calidad_ensayos_muestras")
      .select(
        "id, fecha, producto_id, observaciones, humedad_p_recipiente, humedad_p_inicial, humedad_p_final, peso_vol_gramos, peso_vol_volumen_cc, cal_util_ml_acido, cal_util_peso_muestra_g, granulometria_peso_muestra_g, cargado_por, cargado_en, actualizado_por, actualizado_en"
      )
      .gte("fecha", desdeFecha)
      .order("fecha", { ascending: false })
      .order("cargado_en", { ascending: false })
      .range(desde, hasta)
  );
}

/**
 * Los retenidos de un conjunto de muestras.
 *
 * Filtra por fecha a través de la muestra y **no con un `.in()` de ids**: un
 * `.in()` con muchos ids arma una URL que PostgREST rechaza con un 400 sin
 * decir por qué, y acá un semestre son fácil 400 muestras.
 */
export async function traerRetenidos(supabase: SupabaseClient, desdeFecha: string): Promise<Retenido[]> {
  return traerTodo<Retenido>((desde, hasta) =>
    supabase
      .from("calidad_ensayos_retenidos")
      .select("muestra_id, malla, retenido_g, calidad_ensayos_muestras!inner(fecha)")
      .gte("calidad_ensayos_muestras.fecha", desdeFecha)
      .order("malla")
      .range(desde, hasta)
  );
}
```

- [ ] **Paso 2: Verificar que compila**

```bash
npx tsc --noEmit
```

- [ ] **Paso 3: Commit**

```bash
git commit --only lib/calidad/ensayos/consultas.ts -F - <<'EOF'
feat(calidad): las lecturas de ensayos, todas paginadas
EOF
```

---

## Tarea 7: Las rutas de productos y de límites

**Archivos:**
- Crear: `app/api/calidad/ensayos/productos/route.ts`
- Crear: `app/api/calidad/ensayos/limites/route.ts`

Las dos son **sólo de admin** (`esAdminCalidad`), como la RLS.

- [ ] **Paso 1: `productos/route.ts`**

- `POST`: `{ nombre, grupo, mallas }`. Rechaza nombre vacío (400, *"Falta el
  nombre del producto."*), grupo distinto de `produccion`/`proceso`, y mallas que
  no sean enteros positivos. El `orden` se calcula como el máximo + 1.
- `PATCH`: `{ id, nombre?, grupo?, mallas?, activo?, orden? }`. Lo que no viene,
  no se toca.

Las mallas se normalizan en los dos casos: enteros, sin repetidos, ordenadas
ascendente. Es lo que hace que el juego propuesto salga siempre en el orden
físico del juego de tamices.

- [ ] **Paso 2: `limites/route.ts`**

- `POST`: `{ producto_id, determinacion, malla, minimo, maximo }`.
  - `malla` obligatoria para `retenido` y `acumulado`, prohibida para las otras
    tres (400 con el mensaje que lo diga).
  - Al menos uno de `minimo`/`maximo` (400: *"Un límite necesita un mínimo, un
    máximo, o los dos."*).
  - Si vienen los dos y `minimo > maximo`, 400.
  - **Primero `select` del límite existente, y después `insert` o `update`.** No
    un `upsert` con `onConflict`: el único de los límites sin malla es un índice
    **parcial**, y un índice parcial no sirve como destino de `ON CONFLICT`.
- `DELETE`: `{ id }`. Borrar un límite es volver a "no se controla", que es un
  estado válido del módulo.

- [ ] **Paso 3: Verificar que compila**

```bash
npx tsc --noEmit
```

- [ ] **Paso 4: Commit**

```bash
git commit --only app/api/calidad/ensayos/productos/route.ts app/api/calidad/ensayos/limites/route.ts -F - <<'EOF'
feat(calidad): las rutas de productos y limites de ensayos
EOF
```

---

## Tarea 8: La ruta de muestras

**Archivos:**
- Crear: `app/api/calidad/ensayos/muestras/route.ts`
- Crear: `app/api/calidad/ensayos/muestras/[id]/route.ts`

Permiso: `puedeEditarCalidad`.

- [ ] **Paso 1: `muestras/route.ts` — el `POST`**

Cuerpo: `{ fecha, producto_id, observaciones, humedad: {...}, pesoVol: {...},
calUtil: {...}, granulometria: { pesoMuestraG, retenidos: [{malla, retenido_g}] } }`.

Validaciones, en este orden:

1. `fecha` con forma `YYYY-MM-DD` (400: *"Falta la fecha de la muestra."*).
2. `producto_id` presente (400: *"Falta el producto."*).
3. **Al menos una determinación cargada** (400: *"La muestra no tiene ninguna
   determinación."*). Una muestra vacía no es una muestra.
4. Mallas sin repetir dentro de la granulometría (400 nombrando la repetida).

Después, dos escrituras: `insert` de la muestra y, si hay retenidos, `insert`
de todos juntos. **Si el segundo falla, se borra la muestra recién creada** y se
devuelve el error de Postgres sin traducir — PostgREST no da transacciones
multi-sentencia, y una muestra sin sus retenidos es peor que ninguna muestra:
se lee como una granulometría que dio cero.

- [ ] **Paso 2: `muestras/[id]/route.ts` — `PATCH` y `DELETE`**

- `PATCH`: mismas validaciones. Los retenidos se reemplazan con `delete` +
  `insert` del conjunto entero, y se escribe `actualizado_por`/`actualizado_en`.
- `DELETE`: borra la muestra; los retenidos se van solos por el `on delete
  cascade`.

- [ ] **Paso 3: Verificar que compila**

```bash
npx tsc --noEmit
```

- [ ] **Paso 4: Commit**

```bash
git commit --only app/api/calidad/ensayos/muestras/route.ts "app/api/calidad/ensayos/muestras/[id]/route.ts" -F - <<'EOF'
feat(calidad): alta y correccion de una muestra con sus retenidos
EOF
```

---

## Tarea 9: La pantalla de productos (admin)

**Archivos:**
- Crear: `app/(app)/calidad/ensayos/productos/page.tsx`
- Crear: `app/(app)/calidad/ensayos/productos/ProductosClient.tsx`

- [ ] **Paso 1: El Server Component**

`page.tsx` resuelve sesión con `usuarioActual()`, nivel con `nivelCalidadDe()`,
manda a `/` si no es `admin`, trae `traerProductos()` y se lo pasa al cliente.

- [ ] **Paso 2: El cliente**

Dos grupos separados con su título —**De producción** y **De proceso**—, cada
producto con su nombre, sus mallas como chips, y un botón para editarlas. El
alta es un formulario de una línea: nombre, grupo (`<Select>`) y mallas
separadas por coma.

Las mallas se muestran ordenadas; si un producto tiene `mallas` vacío, dice
**"sin juego habitual"** en gris — que es el estado en que nacen los diez de
proceso y tiene que verse, no ser silencioso.

- [ ] **Paso 3: Verificar**

```bash
npx tsc --noEmit
```

- [ ] **Paso 4: Commit**

```bash
git commit --only "app/(app)/calidad/ensayos/productos/page.tsx" "app/(app)/calidad/ensayos/productos/ProductosClient.tsx" -F - <<'EOF'
feat(calidad): la lista de productos de ensayo y su juego de tamices
EOF
```

---

## Tarea 10: La pantalla de límites (admin)

**Archivos:**
- Crear: `app/(app)/calidad/ensayos/limites/page.tsx`
- Crear: `app/(app)/calidad/ensayos/limites/LimitesClient.tsx`

- [ ] **Paso 1: El Server Component**

Igual que la anterior: sólo `admin`. Trae `traerProductos()` y `traerLimites()`.

- [ ] **Paso 2: El cliente**

Un `<Select>` de producto arriba y, debajo, los límites de ese producto en una
tabla: determinación, malla, mínimo, máximo, y un botón de borrar. El alta es
una fila de formulario; el campo **malla se habilita sólo** cuando la
determinación es `retenido` o `acumulado`.

**Cuando el producto no tiene ningún límite, la pantalla lo dice con todas las
letras:** *"Este producto no tiene límites cargados, así que ninguna muestra se
va a marcar."* Es el estado en que nace el módulo y la diferencia entre
"configurado para no avisar" y "roto" tiene que estar escrita.

- [ ] **Paso 3: Verificar**

```bash
npx tsc --noEmit
```

- [ ] **Paso 4: Commit**

```bash
git commit --only "app/(app)/calidad/ensayos/limites/page.tsx" "app/(app)/calidad/ensayos/limites/LimitesClient.tsx" -F - <<'EOF'
feat(calidad): los limites por producto, y la pantalla dice cuando no hay
EOF
```

---

## Tarea 11: La pantalla de carga

**Archivos:**
- Crear: `app/(app)/calidad/ensayos/nueva/page.tsx`
- Crear: `app/(app)/calidad/ensayos/nueva/CargarClient.tsx`

Es la pantalla principal del frente y la que tiene que andar en un teléfono
parado al lado de la balanza.

- [ ] **Paso 1: El Server Component**

Sesión, nivel (`edicion` o `admin`), `traerProductos()` con `activo = true`.

- [ ] **Paso 2: El cliente**

Encabezado con **fecha** (por defecto hoy), **producto** (`<Select>`) y
**observaciones** (texto libre, con el placeholder *"retorno, producción, silo
3, 600 Hz…"*, que es lo que el Excel guardaba en encabezados sueltos).

Después, cuatro bloques plegables, **todos opcionales**:

| Bloque | Campos |
|---|---|
| Humedad | P recipiente, P inicial, P final |
| Peso volumétrico | Gramos, volumen del recipiente (**precargado en 330**) |
| Cal útil vial | ml de ácido, peso de muestra (**precargado en 3**) |
| Granulometría | Peso de la muestra, y una fila por malla |

**Al elegir el producto, las filas de granulometría se arman con sus mallas
habituales.** Se agrega una malla con un campo al pie y se saca con un botón por
fila. Si el producto no tiene juego habitual, arranca sin filas y se agregan a
mano.

Debajo de cada bloque, **el valor calculado en vivo** usando las mismas
funciones puras: `humedad()`, `pesoVolumetrico()`, `calUtilVial()`,
`granulometria()`. Son puras y corren igual en el cliente, así que quien carga
ve el 0,91% mientras tipea y se da cuenta en el momento si se equivocó de
columna. El `problema`, si lo hay, va en ámbar al lado — **no bloquea el
guardado**.

Para el teléfono: los campos van en una columna sola con `grid-cols-1
sm:grid-cols-3`, los numéricos con `inputMode="decimal"`, y las filas de
granulometría son filas y no una tabla que se salga de la pantalla.

Al guardar: `POST` a `/api/calidad/ensayos/muestras`, y con el `id` que vuelve,
`router.push` al detalle.

- [ ] **Paso 3: Verificar**

```bash
npx tsc --noEmit
```

- [ ] **Paso 4: Commit**

```bash
git commit --only "app/(app)/calidad/ensayos/nueva/page.tsx" "app/(app)/calidad/ensayos/nueva/CargarClient.tsx" -F - <<'EOF'
feat(calidad): la carga de una muestra, con el calculo a la vista mientras se tipea
EOF
```

---

## Tarea 12: El listado

**Archivos:**
- Crear: `app/(app)/calidad/ensayos/page.tsx`
- Crear: `app/(app)/calidad/ensayos/EnsayosClient.tsx`

- [ ] **Paso 1: El Server Component**

Trae productos, límites, y las muestras y retenidos de los últimos 90 días por
defecto. Evalúa cada muestra con `evaluarMuestra()` **en el servidor** y le pasa
al cliente las filas ya evaluadas: la cuenta se hace una vez y la pantalla sólo
dibuja.

- [ ] **Paso 2: El cliente**

Una fila por muestra: fecha, producto, humedad, peso volumétrico, cal útil vial,
acumulado a la malla más fina, y las observaciones recortadas. **Lo que está
fuera de límite va en rojo**; lo que tiene `problema`, en ámbar con el texto
como `title`.

Arriba: filtro de producto (`<Select>`), filtro de mes, y el conteo —*"34
muestras, 2 fuera de límite"*—. Si no hay ningún límite cargado en todo el
módulo, en vez del conteo de desvíos dice *"sin límites cargados"*, que es
distinto de cero desvíos.

Un botón **Cargar muestra** arriba a la derecha, visible sólo con `edicion` o
`admin`.

En pantalla angosta la tabla pasa a tarjetas, una por muestra.

- [ ] **Paso 3: Verificar**

```bash
npx tsc --noEmit
```

- [ ] **Paso 4: Commit**

```bash
git commit --only "app/(app)/calidad/ensayos/page.tsx" "app/(app)/calidad/ensayos/EnsayosClient.tsx" -F - <<'EOF'
feat(calidad): el listado de ensayos, con lo fuera de limite en rojo
EOF
```

---

## Tarea 13: El detalle

**Archivos:**
- Crear: `app/(app)/calidad/ensayos/[id]/page.tsx`
- Crear: `app/(app)/calidad/ensayos/[id]/MuestraClient.tsx`

- [ ] **Paso 1: El Server Component**

Trae la muestra, sus retenidos, su producto y los límites de ese producto.

- [ ] **Paso 2: El cliente**

La misma forma que la carga pero con los valores puestos, y los mismos campos
editables. Muestra **la medición y el resultado juntos** —"P inicial 539,25 ·
P final 538,14 → 0,91%"—, que es lo que permite auditar un número sin abrir otra
pantalla.

La granulometría va como tabla de malla, retenido en gramos, retenido % y
acumulado %, con las dos últimas calculadas.

Al pie, quién la cargó y quién la modificó por última vez, y un botón de borrar
con confirmación.

- [ ] **Paso 3: Verificar**

```bash
npx tsc --noEmit
```

- [ ] **Paso 4: Commit**

```bash
git commit --only "app/(app)/calidad/ensayos/[id]/page.tsx" "app/(app)/calidad/ensayos/[id]/MuestraClient.tsx" -F - <<'EOF'
feat(calidad): el detalle de una muestra, con la medicion al lado del resultado
EOF
```

---

## Tarea 14: El menú, el documento y la verificación final

**Archivos:**
- Modificar: `lib/core/nav.ts`
- Modificar: `CLAUDE.md`
- Crear: `docs/CALIDAD-ENSAYOS.md`

- [ ] **Paso 1: El tercer subgrupo del menú**

En `lib/core/nav.ts`, dentro de los `children` de Calidad y **después** de
Carbonilla y Envases:

```ts
      {
        label: "Ensayos",
        href: "/calidad/ensayos",
        modulo: "calidad",
        // El tercer frente, y el único sin planilla: acá el SdG es el único
        // lugar. Conviene saberlo antes de tocar una ruta, porque los otros dos
        // espejan a Sheets y para lados contrarios.
        children: [
          { label: "Las muestras", href: "/calidad/ensayos", modulo: "calidad" },
          { label: "Cargar muestra", href: "/calidad/ensayos/nueva", modulo: "calidad" },
          { label: "Productos", href: "/calidad/ensayos/productos", modulo: "calidad", soloAdmin: true },
          { label: "Límites", href: "/calidad/ensayos/limites", modulo: "calidad", soloAdmin: true },
        ],
      },
```

**`lib/core/nav.ts` lo tocan todos los módulos**: antes de editarlo, mirar
`git status` sin acotar a ninguna ruta, y commitear con `git commit --only`.

- [ ] **Paso 2: El documento del frente**

`docs/CALIDAD-ENSAYOS.md`, con lo que no se deduce del código: las cinco cosas
que se midieron en el Excel, por qué no se guarda ningún porcentaje, por qué la
lista de productos no apunta al catálogo del núcleo, por qué no hay único por
fecha y producto, y que **no hay planilla**.

- [ ] **Paso 3: La tabla de CLAUDE.md**

En la fila de Calidad, agregar el tercer frente junto a envases y carbonilla:
`ensayos: docs/CALIDAD-ENSAYOS.md · spec · plan`.

- [ ] **Paso 4: Las cuatro verificaciones**

```bash
npm test
```

```bash
npx tsc --noEmit
```

```bash
npm run build
```

(Parar el dev server antes: `next build` con `npm run dev` levantado deja la app
en 500.)

- [ ] **Paso 5: Commit y push**

```bash
git commit --only lib/core/nav.ts docs/CALIDAD-ENSAYOS.md CLAUDE.md -F - <<'EOF'
feat(calidad): los ensayos entran al menu, con su documento
EOF
```

```bash
git push
```

- [ ] **Paso 6: El árbol commiteado**

```bash
node scripts/revisar-arbol-commiteado.mjs
```

Solo, nunca encadenado con `&&` ni con `| tail`: el código de salida de una
tubería es el del último comando y el chequeo se pierde. Es el único de los
cuatro que atrapa un archivo nuevo que quedó *staged* y nunca viajó — eso tiró
cuatro deploys seguidos el 14/09/2026.

---

## Lo que queda pendiente de una persona

1. **Correr la migración.** Hasta entonces las pantallas cargan pero la base no
   tiene dónde escribir.
2. **Cerrar los nombres de los diez productos de proceso**, que la migración
   siembra con los que salieron del Excel.
3. **Confirmar el juego de mallas de cada producto.**
4. **Cargar los límites**, cuando estén decididos.
