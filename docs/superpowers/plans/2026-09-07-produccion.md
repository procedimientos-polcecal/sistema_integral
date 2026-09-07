# Módulo Producción — plan de implementación

> **Para quien lo ejecute:** usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans`, tarea por tarea. Los pasos usan `- [ ]` para poder tacharlos.

**Objetivo:** que el *Informe de Fábrica* que hoy se transcribe a mano en un Excel se cargue en el SdG, que la producción se despeje con una función probada en vez de una columna oculta, y que los tres resúmenes de la planilla de Google se sigan escribiendo solos.

**Arquitectura:** un parte por `(fecha, turno)` con su depósito y sus renglones de despacho. La producción **no se guarda**: se despeja al leer contra el parte anterior en orden cronológico, y cuando ese parte no existe se informa como no calculable. Toda la aritmética vive en `lib/produccion/` como funciones puras con tests; las rutas sólo traen datos, llaman y exportan.

**Diseño acordado:** [`docs/superpowers/specs/2026-09-07-produccion-design.md`](../specs/2026-09-07-produccion-design.md). Leerlo antes de empezar.

**Stack:** Next.js 16 (App Router) · Supabase (Postgres + RLS) · vitest · Google Sheets API vía `lib/core/sheets.ts`.

**Verificación en cada tarea:**

```bash
npm test
npx tsc --noEmit
```

`npm run lint` falla en este repo (no hay config de ESLint) — no es tu cambio. `npm run build` **no** se corre con `npm run dev` levantado: deja la app en 500.

**Nunca `git add -A`.** Puede haber otra sesión en el mismo árbol. Agregá por nombre los archivos de la tarea, que están listados en cada una.

---

## Mapa de archivos

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/<ts>_produccion_enum_del_modulo.sql` | El valor `'produccion'` del enum `modulo`. **Viaja solo** |
| `supabase/migrations/<ts>_produccion_schema.sql` | Tipos, tablas, índices, funciones de permiso y RLS |
| `lib/core/types.ts` | Sumar `"produccion"` al tipo `Modulo` |
| `lib/core/access.ts` | Sumar `"produccion"` a `MODULOS_ORDEN` |
| `lib/core/nav.ts` | El grupo de navegación del módulo. **Se toca en la tarea 17**, no antes: un `admin_sistema` ve el menú apenas se agrega, y hasta entonces sus rutas son 404 |
| `lib/core/fechaDeSheets.ts` | Mudanza al núcleo: la lee un tercer módulo |
| `lib/produccion/types.ts` | Los tipos del módulo. Sin lógica |
| `lib/produccion/turnos.ts` | Cuál es el parte anterior a `(fecha, turno)` |
| `lib/produccion/produccion.ts` | El despeje y los totales del día |
| `lib/produccion/despachos.ts` | Los renglones → totales por producto; kilos ↔ bultos |
| `lib/produccion/planilla.ts` | Las celdas de cada fila de resumen. Sin red |
| `lib/produccion/auth.ts` | Los tres niveles, espejando las funciones de la base |
| `lib/produccion/consultas.ts` | Traer productos, un parte y el depósito del anterior |
| `lib/produccion/espejo.ts` | La escritura a Google. Fino: lee, arma con `planilla.ts`, escribe |
| `app/api/produccion/partes/route.ts` | Guardar un parte y exportarlo |
| `app/api/produccion/planilla/reintentar/route.ts` | Reintentar los pendientes |
| `app/api/produccion/productos/route.ts` | ABM del catálogo, sólo admin |
| `app/(app)/produccion/**` | Las cuatro pantallas |
| `docs/PRODUCCION.md` | El documento del módulo |

**Del núcleo se usa y no se reescribe:** `traerTodo()` (`lib/core/paginado.ts`), `sumarDias()` y `hoyEnArgentina()` (`lib/core/fechas.ts`), `indiceDeCatalogo()` y `elQueNombra()` (`lib/core/catalogo.ts`, para reconocer al capataz que se tipeó del papel), `leerValores()` y `escribirCeldas()` (`lib/core/sheets.ts`), `cuerpoJson()` (`lib/core/cuerpo.ts`), `nivelEnModulo()` (`lib/core/access.ts`).

---

# Parte 1 — Cimientos

## Tarea 1: Las dos migraciones

**Archivos:**
- Crear: `supabase/migrations/<timestamp>_produccion_enum_del_modulo.sql`
- Crear: `supabase/migrations/<timestamp>_produccion_schema.sql`

Las corre **una persona** en el editor SQL de Supabase. Un agente no puede correr DDL. Al terminar esta tarea hay que **decirlo y quedar a la espera**: las tareas 8 en adelante necesitan las tablas.

- [ ] **Paso 1: Generar el primer archivo**

```bash
npm run migracion "produccion enum del modulo"
```

- [ ] **Paso 2: Escribir el enum, y nada más**

En el archivo recién creado:

```sql
-- ============================================================
-- SdG — El módulo Producción entra al enum
--
-- Viaja solo y no hace nada más. Un valor nuevo de enum no se puede usar en la
-- misma transacción en que se agrega: Postgres devuelve 55P04 ("unsafe use of
-- new value of enum type"). Cualquier función o policy que mencione
-- 'produccion' tiene que ir en un archivo posterior, ya commiteado este.
--
-- Es la trampa #1 del README de migraciones, y ya mordió dos veces.
-- ============================================================

alter type modulo add value if not exists 'produccion';
```

- [ ] **Paso 3: Generar el segundo archivo**

```bash
npm run migracion "produccion schema"
```

- [ ] **Paso 4: Escribir el schema completo**

```sql
-- ============================================================
-- SdG — Producción: tipos, tablas, permisos y RLS
--
-- Requiere que la migración del enum ya haya corrido y commiteado.
--
-- Es el primer módulo del SdG que no porta una app: modela el formulario 040/2
-- "INFORME DE FÁBRICA" en papel, uno por turno. Ver
-- docs/superpowers/specs/2026-09-07-produccion-design.md.
--
-- LA PRODUCCIÓN NO SE GUARDA. Se despeja al leer:
--   producción = depósito - depósito anterior + despachado + rotura
-- El "depósito anterior" sale del parte anterior en orden cronológico. Guardarlo
-- es exactamente el error del Excel que este módulo reemplaza: allá vive en una
-- columna oculta única por producto, que el Apps Script pisa al guardar, y que
-- se desincroniza sin que nada avise.
-- ============================================================

-- ── 1. Tipos ─────────────────────────────────────────────────

-- Con las horas adentro del nombre: dice solo que faltan ocho horas sin
-- registrar. El turno de noche, el día que exista, es un valor más.
create type produccion_turno   as enum ('4_12', '12_20');
create type produccion_familia as enum ('filler', '0_2', 'cal', 'otros');
create type produccion_envase  as enum ('bolsa', 'bolson');

-- ── 2. Permisos ──────────────────────────────────────────────
-- Calcadas de las de Inventario (046). Las tres tienen que decir lo mismo que
-- lib/produccion/auth.ts: cuando no coincidieron, en la 029, un admin_sistema
-- veía los botones y RLS le devolvía listas vacías.

create or replace function public.tiene_acceso_produccion()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'produccion'
    ),
    false
  )
$$;

create or replace function public.puede_editar_produccion()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'produccion'
        and nivel in ('edicion', 'admin')
    ),
    false
  )
$$;

create or replace function public.es_admin_produccion()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'produccion'
        and nivel = 'admin'
    ),
    false
  )
$$;

-- ── 3. El catálogo de productos ──────────────────────────────
-- Tabla y no columnas clavadas: en el Excel los 17 productos están como filas
-- en una hoja, como columnas en otras cuatro y como rangos en el script, así que
-- agregar uno es tocar todo.

create table if not exists produccion_productos (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null,
  familia         produccion_familia not null,
  envase          produccion_envase  not null,
  -- La bolsa son 25 kg. El bolsón está sin confirmar, por eso admite null: un
  -- número inventado acá haría fallar la comprobación de kilos contra bultos en
  -- todos los renglones y se terminaría apagando la comprobación.
  kg_por_unidad   numeric,
  -- Cómo se llama su columna en los resúmenes de la planilla. Null = no se
  -- exporta, y eso es una decisión válida, no un dato faltante.
  nombre_planilla text,
  orden           int not null,
  activo          boolean not null default true
);

create unique index if not exists produccion_productos_nombre_idx
  on produccion_productos (lower(nombre));

-- ── 4. El parte de turno ─────────────────────────────────────

create table if not exists produccion_partes (
  id                  uuid primary key default gen_random_uuid(),
  fecha               date not null,
  turno               produccion_turno not null,

  -- El capataz firma el papel. Se guarda lo que dice el papel y, aparte, el
  -- enlace al empleado sólo cuando se lo reconoce con certeza. Enlazar al que se
  -- le parece es peor que dejar en null: el dato aparece en el lugar que no es.
  capataz_raw         text,
  capataz_id          uuid references empleados(id),

  observaciones       text,
  tareas_limpieza     text,
  recuento_bolsones   text,

  cargado_por         uuid not null references usuarios(id),
  cargado_en          timestamptz not null default now(),
  actualizado_por     uuid references usuarios(id),
  actualizado_en      timestamptz,

  -- Por qué no se pudo escribir en la planilla, con lo que dijo Google sin
  -- traducir. Null = está escrito.
  sheets_pendiente    text,
  sheets_pendiente_en timestamptz,

  -- Constraint completa y no índice parcial: es el destino del ON CONFLICT del
  -- upsert. Un índice parcial no sirve para eso — trampa #2 del README.
  unique (fecha, turno)
);

create index if not exists produccion_partes_fecha_idx
  on produccion_partes (fecha desc);

create index if not exists produccion_partes_pendiente_idx
  on produccion_partes (sheets_pendiente_en)
  where sheets_pendiente is not null;

create table if not exists produccion_deposito (
  parte_id    uuid not null references produccion_partes(id) on delete cascade,
  producto_id uuid not null references produccion_productos(id),
  cantidad    numeric not null,
  primary key (parte_id, producto_id)
);

create table if not exists produccion_despachos (
  id               uuid primary key default gen_random_uuid(),
  parte_id         uuid not null references produccion_partes(id) on delete cascade,
  orden            int not null,

  equipo_raw       text,
  -- No hay catálogo de clientes en el núcleo: va a ser del módulo Despacho.
  cliente_raw      text,

  -- Puede ser null con el texto crudo al lado: el papel tiene un renglón
  -- "Otros" y nombres escritos a mano que no siempre se reconocen.
  producto_id      uuid references produccion_productos(id),
  producto_raw     text,

  kilos            numeric,
  bultos           numeric,
  envase_raw       text,
  pallets_cantidad numeric,
  pallets_tipo     text,

  -- Separadas como en el papel: la rotura pasa al cargar el camión.
  rotura_bolsa     numeric not null default 0,
  rotura_bolson    numeric not null default 0
);

create index if not exists produccion_despachos_parte_idx
  on produccion_despachos (parte_id);

-- ── 5. RLS ───────────────────────────────────────────────────

alter table produccion_productos enable row level security;
alter table produccion_partes    enable row level security;
alter table produccion_deposito  enable row level security;
alter table produccion_despachos enable row level security;

drop policy if exists produccion_productos_select on produccion_productos;
create policy produccion_productos_select on produccion_productos
  for select to authenticated using (tiene_acceso_produccion());

drop policy if exists produccion_productos_write on produccion_productos;
create policy produccion_productos_write on produccion_productos
  for all to authenticated
  using (es_admin_produccion())
  with check (es_admin_produccion());

drop policy if exists produccion_partes_select on produccion_partes;
create policy produccion_partes_select on produccion_partes
  for select to authenticated using (tiene_acceso_produccion());

-- Los partes sí se corrigen, a diferencia del kardex de Inventario: el papel se
-- transcribe y transcribir se equivoca. Queda el rastro de quién y cuándo.
drop policy if exists produccion_partes_write on produccion_partes;
create policy produccion_partes_write on produccion_partes
  for all to authenticated
  using (puede_editar_produccion())
  with check (puede_editar_produccion());

drop policy if exists produccion_deposito_select on produccion_deposito;
create policy produccion_deposito_select on produccion_deposito
  for select to authenticated using (tiene_acceso_produccion());

drop policy if exists produccion_deposito_write on produccion_deposito;
create policy produccion_deposito_write on produccion_deposito
  for all to authenticated
  using (puede_editar_produccion())
  with check (puede_editar_produccion());

drop policy if exists produccion_despachos_select on produccion_despachos;
create policy produccion_despachos_select on produccion_despachos
  for select to authenticated using (tiene_acceso_produccion());

drop policy if exists produccion_despachos_write on produccion_despachos;
create policy produccion_despachos_write on produccion_despachos
  for all to authenticated
  using (puede_editar_produccion())
  with check (puede_editar_produccion());

comment on table produccion_partes is
  'Un parte por turno, que es un papel 040/2. La producción no está acá: se despeja contra el depósito del parte anterior.';
```

- [ ] **Paso 5: Commit**

```bash
git add supabase/migrations/*_produccion_enum_del_modulo.sql supabase/migrations/*_produccion_schema.sql
git commit -m "feat(produccion): las tablas del modulo, el enum en su propio archivo"
```

- [ ] **Paso 6: Avisar y esperar**

Decirle al usuario que hay dos migraciones para correr en el editor SQL de Supabase, **en orden**, y que la segunda falla con `55P04` si la primera no está commiteada. No seguir con la tarea 8 hasta que confirme.

Las tareas 2 a 7 no tocan la base y se pueden hacer mientras tanto.

---

## Tarea 2: El módulo en el núcleo

**Archivos:**
- Modificar: `lib/core/types.ts:2`
- Modificar: `lib/core/access.ts:4`
- Modificar: `lib/core/nav.ts` (después del grupo de Inventario)
- Crear: `lib/produccion/types.ts`

- [ ] **Paso 1: Sumar el módulo al tipo**

En `lib/core/types.ts`, línea 2:

```ts
export type Modulo = "rrhh" | "mantenimiento" | "remises" | "compras" | "inventario" | "produccion";
```

- [ ] **Paso 2: Sumarlo al orden de navegación**

En `lib/core/access.ts`, línea 4:

```ts
export const MODULOS_ORDEN: Modulo[] = ["rrhh", "mantenimiento", "remises", "compras", "inventario", "produccion"];
```

- [ ] **Paso 3: El menú NO se toca todavía**

`lib/core/nav.ts` se modifica recién en la **tarea 17**, cuando existan las tres pantallas.

El motivo salió de la revisión de esta tarea: `modulosVisibles()` (`lib/core/access.ts:11`) le devuelve **todos** los módulos a un `admin_sistema` sin mirar `usuario_modulos`, y `nivelEnModulo()` le da nivel `admin` en todos. Así que el grupo del menú no queda oculto esperando que alguien reciba el permiso: se ve desde el momento en que se agrega, y sus rutas dan 404 hasta la parte 5. Como acá se pushea a producción al terminar cada tarea, eso serían quince tareas con un menú roto en la app real.

- [ ] **Paso 4: Los tipos del módulo**

Crear `lib/produccion/types.ts`:

```ts
/**
 * Los tipos del módulo Producción. Sin lógica: lo que decide algo vive en los
 * otros archivos de esta carpeta, para poder probarlo.
 */

export type Turno = "4_12" | "12_20";
export type Familia = "filler" | "0_2" | "cal" | "otros";
export type Envase = "bolsa" | "bolson";

export interface Producto {
  id: string;
  nombre: string;
  familia: Familia;
  envase: Envase;
  /** 25 la bolsa. El bolsón puede estar sin confirmar, y entonces es null. */
  kg_por_unidad: number | null;
  /** La columna en los resúmenes de la planilla. Null = no se exporta. */
  nombre_planilla: string | null;
  orden: number;
  activo: boolean;
}

export interface Parte {
  id: string;
  /** "YYYY-MM-DD" */
  fecha: string;
  turno: Turno;
  capataz_raw: string | null;
  capataz_id: string | null;
  observaciones: string | null;
  tareas_limpieza: string | null;
  recuento_bolsones: string | null;
  sheets_pendiente: string | null;
  sheets_pendiente_en: string | null;
}

export interface Despacho {
  id: string;
  parte_id: string;
  orden: number;
  equipo_raw: string | null;
  cliente_raw: string | null;
  producto_id: string | null;
  producto_raw: string | null;
  kilos: number | null;
  bultos: number | null;
  envase_raw: string | null;
  pallets_cantidad: number | null;
  pallets_tipo: string | null;
  rotura_bolsa: number;
  rotura_bolson: number;
}

/** Cantidad por producto. La clave es el id del producto. */
export type PorProducto = Readonly<Record<string, number>>;
```

- [ ] **Paso 5: Comprobar que compila y que no rompió nada**

```bash
npx tsc --noEmit
npm test
```

Esperado: sin errores. Si `tsc` se queja de un `Record<Modulo, …>` que ahora no cubre `"produccion"` —hay uno de etiquetas en `app/(app)/administracion/usuarios/UsuariosClient.tsx`, y el test de `lib/core/access.test.ts` espera la lista de módulos completa— arreglarlos: son consecuencia directa de este cambio. Si se queja de un archivo que no tiene nada que ver, mirar `git status` antes de tocarlo — puede ser el refactor de otra sesión.

- [ ] **Paso 6: Commit**

```bash
git add lib/core/types.ts lib/core/access.ts lib/produccion/types.ts "app/(app)/administracion/usuarios/UsuariosClient.tsx" lib/core/access.test.ts
git commit -m "feat(produccion): el modulo en el nucleo y sus tipos"
```

---

# Parte 2 — La lógica pura

Todo esto se hace con TDD y **no necesita la base**: se puede empezar antes de que las migraciones estén corridas.

## Tarea 3: `fechaDeSheets` al núcleo

Producción es el **tercer** módulo que la necesita, y la regla de `docs/NUCLEO-COMPARTIDO.md` es explícita: *"si está en otro módulo, sacarla al núcleo con sus tests en el mismo commit"*. Hoy vive en `lib/mantenimiento/planilla.ts:29` e Inventario la importa desde ahí.

**Archivos:**
- Crear: `lib/core/fechaDeSheets.ts`
- Crear: `lib/core/fechaDeSheets.test.ts`
- Modificar: `lib/mantenimiento/planilla.ts:29-45`

Los importadores **no se tocan**: son cinco archivos más un test, y todos traen `fechaDeSheets` en el mismo `import` que `texto`, `normalizar`, `monto` o `codigoDeEquipo`, que no se mudan. Partir ese import en dos por una función es más ruido que la indirección que evita. Por eso el paso 5 deja una reexportación.

- [ ] **Paso 1: Escribir el test que falla**

Crear `lib/core/fechaDeSheets.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fechaDeSheets } from "./fechaDeSheets";

describe("la fecha que devuelve una planilla", () => {
  it("un serial de Sheets es el dia que representa", () => {
    // 45000 = 2023-03-15. El origen de Sheets es 1899-12-30.
    expect(fechaDeSheets(45000)).toBe("2023-03-15");
  });

  /**
   * Es la regla que dio vuelta 885 fechas en Compras: el texto de una planilla
   * argentina viene d/m, y leerlo como m/d cambia el dato sin romper nada.
   */
  it("el texto se lee d/m y nunca m/d", () => {
    expect(fechaDeSheets("3/9/2026")).toBe("2026-09-03");
    expect(fechaDeSheets("13/9/2026")).toBe("2026-09-13");
  });

  it("un ISO se devuelve tal cual", () => {
    expect(fechaDeSheets("2026-09-03")).toBe("2026-09-03");
  });

  it("lo que no es una fecha es null, no hoy", () => {
    expect(fechaDeSheets("")).toBeNull();
    expect(fechaDeSheets(null)).toBeNull();
    expect(fechaDeSheets(undefined)).toBeNull();
    expect(fechaDeSheets("sin fecha")).toBeNull();
  });
});
```

- [ ] **Paso 2: Correrlo y ver que falla**

```bash
npx vitest run lib/core/fechaDeSheets.test.ts
```

Esperado: FAIL, `Failed to resolve import "./fechaDeSheets"`.

- [ ] **Paso 3: Crear el archivo del núcleo**

Crear `lib/core/fechaDeSheets.ts` con el cuerpo que hoy está en `lib/mantenimiento/planilla.ts:29-45`, más el encabezado que explica por qué está acá:

```ts
/**
 * La fecha que devuelve una planilla, sea serial o texto.
 *
 * Estaba en `lib/mantenimiento/planilla.ts` y la importaba Inventario desde
 * ahí. Producción es el tercero: por la regla de `docs/NUCLEO-COMPARTIDO.md`,
 * a la tercera se muda al núcleo con sus tests.
 *
 * **El texto se lee d/m y nunca m/d.** Leerlo al revés dio vuelta 885 fechas en
 * Compras, y es un error que no rompe nada: el dato simplemente queda mal.
 */
export function fechaDeSheets(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === "") return null;

  const n = Number(valor);
  if (!isNaN(n) && n >= 1) {
    const ms = (Math.floor(n) - 25569) * 86400 * 1000;
    return new Date(ms).toISOString().slice(0, 10);
  }

  const s = String(valor).trim();

  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;

  const iso = s.match(/^\d{4}-\d{2}-\d{2}/);
  return iso ? iso[0] : null;
}
```

- [ ] **Paso 4: Correr el test y verlo pasar**

```bash
npx vitest run lib/core/fechaDeSheets.test.ts
```

Esperado: PASS, 4 tests.

- [ ] **Paso 5: Dejar una sola copia**

En `lib/mantenimiento/planilla.ts`, borrar la función de las líneas 29-45 y reemplazarla por una reexportación, para no tocar los importadores que la traen de ahí:

```ts
// La regla de qué fecha devuelve una planilla vive en el núcleo desde que la
// necesitó el tercer módulo. Se reexporta para no cambiar los importadores.
export { fechaDeSheets } from "@/lib/core/fechaDeSheets";
```

- [ ] **Paso 6: Comprobar que no se rompió nada**

```bash
npm test
npx tsc --noEmit
```

Esperado: todos los tests que ya pasaban siguen pasando.

- [ ] **Paso 7: Commit**

```bash
git add lib/core/fechaDeSheets.ts lib/core/fechaDeSheets.test.ts lib/mantenimiento/planilla.ts
git commit -m "refactor(nucleo): fechaDeSheets al nucleo, que la piden tres modulos"
```

---

## Tarea 4: `turnos.ts` — cuál es el parte anterior

**Archivos:**
- Crear: `lib/produccion/turnos.ts`
- Crear: `lib/produccion/turnos.test.ts`

- [ ] **Paso 1: Escribir el test que falla**

Crear `lib/produccion/turnos.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parteAnterior, comoSeLeeElTurno, TURNOS } from "./turnos";

describe("cual es el parte anterior", () => {
  it("el anterior al turno de la tarde es el de la manana del mismo dia", () => {
    expect(parteAnterior({ fecha: "2026-09-03", turno: "12_20" }))
      .toEqual({ fecha: "2026-09-03", turno: "4_12" });
  });

  it("el anterior al turno de la manana es la tarde del dia previo", () => {
    expect(parteAnterior({ fecha: "2026-09-03", turno: "4_12" }))
      .toEqual({ fecha: "2026-09-02", turno: "12_20" });
  });

  it("cruza el mes", () => {
    expect(parteAnterior({ fecha: "2026-09-01", turno: "4_12" }))
      .toEqual({ fecha: "2026-08-31", turno: "12_20" });
  });

  it("cruza el ano", () => {
    expect(parteAnterior({ fecha: "2026-01-01", turno: "4_12" }))
      .toEqual({ fecha: "2025-12-31", turno: "12_20" });
  });
});

describe("como se muestran los turnos", () => {
  it("son dos y en el orden en que ocurren", () => {
    expect(TURNOS).toEqual(["4_12", "12_20"]);
  });

  it("se leen con las horas", () => {
    expect(comoSeLeeElTurno("4_12")).toBe("4 a 12");
    expect(comoSeLeeElTurno("12_20")).toBe("12 a 20");
  });
});
```

- [ ] **Paso 2: Correrlo y ver que falla**

```bash
npx vitest run lib/produccion/turnos.test.ts
```

Esperado: FAIL, `Failed to resolve import "./turnos"`.

- [ ] **Paso 3: Implementar**

Crear `lib/produccion/turnos.ts`:

```ts
import { sumarDias } from "@/lib/core/fechas";
import type { Turno } from "./types";

/**
 * El orden de los partes, que es lo que permite despejar la producción.
 *
 * En el Excel esto no existe como concepto: el "stock del turno anterior" es una
 * columna oculta que el Apps Script pisa al guardar, la misma para todas las
 * fechas. Acá es una función de dos ramas, y por eso no se puede desincronizar.
 */

/** Los dos turnos, en el orden en que ocurren dentro del día. */
export const TURNOS: readonly Turno[] = ["4_12", "12_20"];

export interface ClaveDeParte {
  /** "YYYY-MM-DD" */
  fecha: string;
  turno: Turno;
}

export function parteAnterior(clave: ClaveDeParte): ClaveDeParte {
  if (clave.turno === "12_20") return { fecha: clave.fecha, turno: "4_12" };
  return { fecha: sumarDias(clave.fecha, -1), turno: "12_20" };
}

export function comoSeLeeElTurno(turno: Turno): string {
  return turno === "4_12" ? "4 a 12" : "12 a 20";
}

/** Si el texto es uno de los dos turnos. Para validar lo que llega por la URL. */
export function esTurno(valor: unknown): valor is Turno {
  return valor === "4_12" || valor === "12_20";
}
```

- [ ] **Paso 4: Correr el test y verlo pasar**

```bash
npx vitest run lib/produccion/turnos.test.ts
```

Esperado: PASS, 6 tests. Si el cruce de mes falla, mirar `sumarDias` en `lib/core/fechas.ts:68` — el test está bien y lo que hay que revisar es el helper.

- [ ] **Paso 5: Commit**

```bash
git add lib/produccion/turnos.ts lib/produccion/turnos.test.ts
git commit -m "feat(produccion): el orden de los partes, que es de donde sale el deposito anterior"
```

---

## Tarea 5: `produccion.ts` — el despeje

Es el corazón del módulo: la fórmula que hoy vive en una celda de Excel.

**Archivos:**
- Crear: `lib/produccion/produccion.ts`
- Crear: `lib/produccion/produccion.test.ts`

- [ ] **Paso 1: Escribir el test que falla**

Los números son los del archivo relevado (03/09/2026), que son legibles sin ambigüedad. Crear `lib/produccion/produccion.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { produccionDelTurno, produccionDelDia } from "./produccion";

/** Bolsones de Calcio 0-1, 03/09/2026, tal como está en el Excel relevado. */
const calcio01 = "p-calcio-0-1";

describe("la produccion de un turno", () => {
  it("es deposito - deposito anterior + despachado + rotura", () => {
    const r = produccionDelTurno({
      deposito: { [calcio01]: 29 },
      depositoAnterior: { [calcio01]: 17 },
      despachado: { [calcio01]: 0 },
      rotura: { [calcio01]: 0 },
    });
    expect(r[calcio01]).toEqual({ estado: "calculada", cantidad: 12 });
  });

  it("el turno siguiente arranca del deposito del anterior", () => {
    const r = produccionDelTurno({
      deposito: { [calcio01]: 17 },
      depositoAnterior: { [calcio01]: 29 },
      despachado: { [calcio01]: 13 },
      rotura: { [calcio01]: 0 },
    });
    expect(r[calcio01]).toEqual({ estado: "calculada", cantidad: 1 });
  });

  /**
   * La razón de ser del módulo. Un cero no se distingue de un día sin producir,
   * y así es como se pierde media semana sin que nada avise.
   */
  it("sin parte anterior no calcula, y lo dice", () => {
    const r = produccionDelTurno({
      deposito: { [calcio01]: 29 },
      depositoAnterior: null,
      despachado: { [calcio01]: 0 },
      rotura: { [calcio01]: 0 },
    });
    expect(r[calcio01]).toEqual({ estado: "sin_parte_anterior" });
  });

  /** Una producción negativa es un error de carga y hay que verlo, no taparlo. */
  it("una produccion negativa se devuelve negativa", () => {
    const r = produccionDelTurno({
      deposito: { [calcio01]: 0 },
      depositoAnterior: { [calcio01]: 10 },
      despachado: {},
      rotura: {},
    });
    expect(r[calcio01]).toEqual({ estado: "calculada", cantidad: -10 });
  });

  it("un producto que solo aparece en el despacho igual se calcula", () => {
    const r = produccionDelTurno({
      deposito: {},
      depositoAnterior: {},
      despachado: { [calcio01]: 13 },
      rotura: {},
    });
    expect(r[calcio01]).toEqual({ estado: "calculada", cantidad: 13 });
  });

  it("un producto que no aparece en ningun lado no aparece en el resultado", () => {
    const r = produccionDelTurno({
      deposito: {}, depositoAnterior: {}, despachado: {}, rotura: {},
    });
    expect(Object.keys(r)).toEqual([]);
  });
});

describe("la produccion del dia", () => {
  it("suma los dos turnos", () => {
    const t1 = produccionDelTurno({
      deposito: { [calcio01]: 29 },
      depositoAnterior: { [calcio01]: 17 },
      despachado: {}, rotura: {},
    });
    const t2 = produccionDelTurno({
      deposito: { [calcio01]: 17 },
      depositoAnterior: { [calcio01]: 29 },
      despachado: { [calcio01]: 13 }, rotura: {},
    });
    expect(produccionDelDia([t1, t2])[calcio01]).toEqual({ estado: "calculada", cantidad: 13 });
  });

  /** Si un turno no se puede calcular, el día tampoco. Medio día no es un día. */
  it("si un turno no se puede calcular, el dia tampoco", () => {
    const t1 = produccionDelTurno({
      deposito: { [calcio01]: 29 }, depositoAnterior: null, despachado: {}, rotura: {},
    });
    const t2 = produccionDelTurno({
      deposito: { [calcio01]: 17 },
      depositoAnterior: { [calcio01]: 29 },
      despachado: { [calcio01]: 13 }, rotura: {},
    });
    expect(produccionDelDia([t1, t2])[calcio01]).toEqual({ estado: "sin_parte_anterior" });
  });
});
```

- [ ] **Paso 2: Correrlo y ver que falla**

```bash
npx vitest run lib/produccion/produccion.test.ts
```

Esperado: FAIL, `Failed to resolve import "./produccion"`.

- [ ] **Paso 3: Implementar**

Crear `lib/produccion/produccion.ts`:

```ts
import type { PorProducto } from "./types";

/**
 * Despejar la producción de un turno.
 *
 * Ni el papel ni el Excel anotan lo producido: sale de la cuenta
 *
 *     producción = depósito − depósito anterior + despachado + rotura
 *
 * El "depósito anterior" es el del parte anterior en orden cronológico, y **no
 * se guarda en ningún lado**: se lee. Guardarlo es el error del Excel, donde
 * vive en una columna oculta única por producto que el script pisa al guardar y
 * que se desincroniza sin avisar.
 */

export interface EntradaDelTurno {
  deposito: PorProducto;
  /** El depósito del parte anterior. `null` = ese parte no existe todavía. */
  depositoAnterior: PorProducto | null;
  despachado: PorProducto;
  rotura: PorProducto;
}

export type ProduccionDelProducto =
  | { estado: "calculada"; cantidad: number }
  | { estado: "sin_parte_anterior" };

export type ProduccionPorProducto = Record<string, ProduccionDelProducto>;

export function produccionDelTurno(e: EntradaDelTurno): ProduccionPorProducto {
  const ids = new Set([
    ...Object.keys(e.deposito),
    ...Object.keys(e.depositoAnterior ?? {}),
    ...Object.keys(e.despachado),
    ...Object.keys(e.rotura),
  ]);

  const salida: ProduccionPorProducto = {};
  for (const id of ids) {
    // Sin el parte anterior no hay resta posible. Devolver 0 sería inventar un
    // día sin producción, que es indistinguible de un día bien cargado.
    if (e.depositoAnterior === null) {
      salida[id] = { estado: "sin_parte_anterior" };
      continue;
    }
    salida[id] = {
      estado: "calculada",
      // Puede dar negativo, y se devuelve negativo: es un error de carga y la
      // pantalla lo muestra en rojo. Recortarlo a cero lo esconde.
      cantidad:
        (e.deposito[id] ?? 0) -
        (e.depositoAnterior[id] ?? 0) +
        (e.despachado[id] ?? 0) +
        (e.rotura[id] ?? 0),
    };
  }
  return salida;
}

/** El día es la suma de sus turnos. Si a uno le falta el anterior, el día tampoco se puede. */
export function produccionDelDia(
  turnos: readonly ProduccionPorProducto[]
): ProduccionPorProducto {
  const salida: ProduccionPorProducto = {};

  for (const turno of turnos) {
    for (const [id, p] of Object.entries(turno)) {
      const acumulado = salida[id];
      if (p.estado === "sin_parte_anterior" || acumulado?.estado === "sin_parte_anterior") {
        salida[id] = { estado: "sin_parte_anterior" };
        continue;
      }
      salida[id] = {
        estado: "calculada",
        cantidad: (acumulado?.cantidad ?? 0) + p.cantidad,
      };
    }
  }
  return salida;
}

/** Sólo lo calculado, para exportar a la planilla. Lo no calculable no se exporta. */
export function soloLoCalculado(p: ProduccionPorProducto): Record<string, number> {
  const salida: Record<string, number> = {};
  for (const [id, v] of Object.entries(p)) {
    if (v.estado === "calculada") salida[id] = v.cantidad;
  }
  return salida;
}
```

- [ ] **Paso 4: Correr el test y verlo pasar**

```bash
npx vitest run lib/produccion/produccion.test.ts
```

Esperado: PASS, 8 tests.

- [ ] **Paso 5: Commit**

```bash
git add lib/produccion/produccion.ts lib/produccion/produccion.test.ts
git commit -m "feat(produccion): el despeje de la produccion, que en el Excel es una celda"
```

---

## Tarea 6: `despachos.ts` — de renglones a totales

**Archivos:**
- Crear: `lib/produccion/despachos.ts`
- Crear: `lib/produccion/despachos.test.ts`

- [ ] **Paso 1: Escribir el test que falla**

Crear `lib/produccion/despachos.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { totalesDeDespacho, roturaTotal, desajustesDeKilos } from "./despachos";
import type { Despacho } from "./types";

const base: Despacho = {
  id: "d-1", parte_id: "pa-1", orden: 1,
  equipo_raw: "Bailin", cliente_raw: "Guemes",
  producto_id: "p-cal-bolsa", producto_raw: "Cal en bolsas",
  kilos: 30000, bultos: 1200, envase_raw: "bolsa",
  pallets_cantidad: null, pallets_tipo: null,
  rotura_bolsa: 0, rotura_bolson: 0,
};

describe("los totales de un parte salen de los renglones", () => {
  it("suma los bultos por producto", () => {
    const t = totalesDeDespacho([
      base,
      { ...base, id: "d-2", orden: 2, bultos: 40, kilos: 1000 },
    ]);
    expect(t.despachado).toEqual({ "p-cal-bolsa": 1240 });
  });

  /** La rotura queda separada porque en el papel está separada. */
  it("la rotura de bolsa y la de bolson no se mezclan", () => {
    const t = totalesDeDespacho([
      { ...base, rotura_bolsa: 1 },
      { ...base, id: "d-2", orden: 2, rotura_bolson: 2 },
    ]);
    expect(t.roturaBolsa).toEqual({ "p-cal-bolsa": 1 });
    expect(t.roturaBolson).toEqual({ "p-cal-bolsa": 2 });
    expect(roturaTotal(t)).toEqual({ "p-cal-bolsa": 3 });
  });

  /**
   * El papel tiene un renglón "Otros" y nombres escritos a mano. Un renglón sin
   * producto reconocido no se suma a ninguno —sumarlo al parecido pone el dato
   * en el lugar que no es— pero tampoco se pierde: sale listado.
   */
  it("un renglon sin producto no se suma pero no se pierde", () => {
    const suelto = { ...base, id: "d-3", orden: 3, producto_id: null, producto_raw: "Otros: cal" };
    const t = totalesDeDespacho([base, suelto]);
    expect(t.despachado).toEqual({ "p-cal-bolsa": 1200 });
    expect(t.sinProducto.map((d) => d.id)).toEqual(["d-3"]);
  });

  it("un renglon sin bultos no rompe la suma", () => {
    const t = totalesDeDespacho([{ ...base, bultos: null }]);
    expect(t.despachado).toEqual({ "p-cal-bolsa": 0 });
  });
});

describe("los kilos contra los bultos", () => {
  const kg = new Map<string, number | null>([["p-cal-bolsa", 25]]);

  it("1200 bolsas de 25 kg son 30.000 y no desajustan", () => {
    expect(desajustesDeKilos([base], kg)).toEqual([]);
  });

  it("un renglon que no cierra sale listado con lo que se esperaba", () => {
    const malo = { ...base, id: "d-9", kilos: 29280 };
    expect(desajustesDeKilos([malo], kg)).toEqual([
      { despachoId: "d-9", bultos: 1200, kilos: 29280, kilosEsperados: 30000 },
    ]);
  });

  /** Sin kg por unidad no se puede comparar, y no se inventa un número. */
  it("un producto sin kg por unidad no se comprueba", () => {
    const sinKg = new Map<string, number | null>([["p-cal-bolsa", null]]);
    expect(desajustesDeKilos([{ ...base, kilos: 1 }], sinKg)).toEqual([]);
  });

  it("un renglon sin kilos o sin bultos no se comprueba", () => {
    expect(desajustesDeKilos([{ ...base, kilos: null }], kg)).toEqual([]);
    expect(desajustesDeKilos([{ ...base, bultos: null }], kg)).toEqual([]);
  });
});
```

- [ ] **Paso 2: Correrlo y ver que falla**

```bash
npx vitest run lib/produccion/despachos.test.ts
```

Esperado: FAIL, `Failed to resolve import "./despachos"`.

- [ ] **Paso 3: Implementar**

Crear `lib/produccion/despachos.ts`:

```ts
import type { Despacho } from "./types";

/**
 * De los renglones del papel a los totales por producto.
 *
 * En el Excel estos totales se tipean ya sumados. Son una cuenta hecha a mano
 * sobre números que ya están escritos en el papel: hacerla acá quita un paso y
 * un lugar donde equivocarse.
 */

export interface TotalesDeDespacho {
  /** Bultos despachados por producto. */
  despachado: Record<string, number>;
  /** Separadas como en el papel: la rotura pasa al cargar el camión. */
  roturaBolsa: Record<string, number>;
  roturaBolson: Record<string, number>;
  /** Renglones sin producto reconocido. No se suman, pero no se pierden. */
  sinProducto: Despacho[];
}

export function totalesDeDespacho(renglones: readonly Despacho[]): TotalesDeDespacho {
  const t: TotalesDeDespacho = {
    despachado: {}, roturaBolsa: {}, roturaBolson: {}, sinProducto: [],
  };

  for (const r of renglones) {
    if (!r.producto_id) {
      t.sinProducto.push(r);
      continue;
    }
    const id = r.producto_id;
    t.despachado[id] = (t.despachado[id] ?? 0) + (r.bultos ?? 0);
    t.roturaBolsa[id] = (t.roturaBolsa[id] ?? 0) + (r.rotura_bolsa ?? 0);
    t.roturaBolson[id] = (t.roturaBolson[id] ?? 0) + (r.rotura_bolson ?? 0);
  }
  return t;
}

/**
 * La rotura de un producto, sumadas las dos.
 *
 * El despeje de la producción y la columna de rotura de la planilla quieren un
 * solo número; la pantalla muestra las dos por separado, que es como se cargan.
 */
export function roturaTotal(t: TotalesDeDespacho): Record<string, number> {
  const salida: Record<string, number> = {};
  for (const id of new Set([...Object.keys(t.roturaBolsa), ...Object.keys(t.roturaBolson)])) {
    salida[id] = (t.roturaBolsa[id] ?? 0) + (t.roturaBolson[id] ?? 0);
  }
  return salida;
}

export interface DesajusteDeKilos {
  despachoId: string;
  bultos: number;
  kilos: number;
  kilosEsperados: number;
}

/**
 * Los renglones donde los kilos no cierran con los bultos.
 *
 * **Avisa, no bloquea.** El papel es el papel: si el capataz escribió dos
 * números que no cierran, el parte se guarda igual y la pantalla muestra la
 * diferencia. Corregir el papel desde el sistema sería inventar.
 *
 * La tolerancia por defecto es 5%: una bolsa no pesa exactamente 25 kg y el
 * camión se pesa en báscula.
 */
export function desajustesDeKilos(
  renglones: readonly Despacho[],
  kgPorUnidad: ReadonlyMap<string, number | null>,
  tolerancia = 0.05
): DesajusteDeKilos[] {
  const salida: DesajusteDeKilos[] = [];

  for (const r of renglones) {
    if (!r.producto_id || r.kilos === null || r.bultos === null) continue;

    const kg = kgPorUnidad.get(r.producto_id);
    // Sin kg por unidad no hay contra qué comparar, y no se inventa un número:
    // el del bolsón está sin confirmar.
    if (!kg) continue;

    const esperados = r.bultos * kg;
    if (esperados === 0) continue;

    if (Math.abs(r.kilos - esperados) / esperados > tolerancia) {
      salida.push({
        despachoId: r.id,
        bultos: r.bultos,
        kilos: r.kilos,
        kilosEsperados: esperados,
      });
    }
  }
  return salida;
}
```

- [ ] **Paso 4: Correr el test y verlo pasar**

```bash
npx vitest run lib/produccion/despachos.test.ts
```

Esperado: PASS, 8 tests.

- [ ] **Paso 5: Commit**

```bash
git add lib/produccion/despachos.ts lib/produccion/despachos.test.ts
git commit -m "feat(produccion): los totales salen de los renglones y no se tipean"
```

---

## Tarea 7: `planilla.ts` — las celdas de los resúmenes

**Archivos:**
- Crear: `lib/produccion/planilla.ts`
- Crear: `lib/produccion/planilla.test.ts`

Contexto de la planilla, relevado del archivo real: las tres pestañas de resumen tienen los encabezados en la **fila 4** y las fechas en la columna A de la **fila 5 a la 34**. `Resumen Rotura` tiene además un segundo bloque con los porcentajes, que arranca en la columna `S`; la fila 3 lo marca con el texto `% ROTURA / PRODUCCIÓN`, y los nombres de los productos **se repiten** en los dos bloques — por eso buscar el nombre en toda la fila de encabezados encontraría siempre el primer bloque.

- [ ] **Paso 1: Escribir el test que falla**

Crear `lib/produccion/planilla.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  filaDeLaFecha,
  comienzoDelBloqueDePorcentaje,
  celdasDeResumen,
  porcentajeDeRotura,
} from "./planilla";
import type { Producto } from "./types";

const producto = (id: string, nombre_planilla: string | null, orden: number): Producto => ({
  id, nombre: id, familia: "cal", envase: "bolsa",
  kg_por_unidad: 25, nombre_planilla, orden, activo: true,
});

const CAL = producto("p-cal", "Bolsones de Cal", 1);
const FILLER = producto("p-filler", "Bolsones de Filler", 2);
const INTERNO = producto("p-interno", null, 3);

const ENCABEZADOS = ["FECHA", "Bolsones de Cal", "Bolsones de Filler"];

describe("en que fila del resumen va una fecha", () => {
  // Como llega de Sheets con `sinFormato`: seriales, una fila por celda.
  const columnaA = [["46266"], ["46267"], ["46268"]]; // 01, 02 y 03/09/2026

  it("encuentra la fila por la fecha y no contando", () => {
    expect(filaDeLaFecha(columnaA, "2026-09-02", 5)).toBe(6);
  });

  /** Los resúmenes llegan hasta el día 30: un 31 no tiene fila y no se adivina. */
  it("una fecha que no esta devuelve null", () => {
    expect(filaDeLaFecha(columnaA, "2026-09-30", 5)).toBeNull();
  });

  it("una celda vacia no corre la cuenta", () => {
    expect(filaDeLaFecha([[""], ["46267"]], "2026-09-02", 5)).toBe(6);
  });
});

describe("donde arranca el bloque de porcentajes", () => {
  it("lo dice la fila 3 de Resumen Rotura", () => {
    const fila3 = ["UNIDADES ROTAS", "", "", "", "", "", "", "", "", "", "",
                   "", "", "", "", "", "", "", "% ROTURA / PRODUCCIÓN"];
    expect(comienzoDelBloqueDePorcentaje(fila3)).toBe(18);
  });

  /** Sin el marcador no se adivina una columna: se informa y no se escribe. */
  it("sin el marcador devuelve null", () => {
    expect(comienzoDelBloqueDePorcentaje(["UNIDADES ROTAS", "", ""])).toBeNull();
  });
});

describe("las celdas de una fila de resumen", () => {
  it("pone cada producto en la columna que dice su nombre en la planilla", () => {
    const r = celdasDeResumen(ENCABEZADOS, [CAL, FILLER], { "p-cal": 18, "p-filler": 2 });
    expect(r.celdas).toEqual([
      { columna: 1, valor: "18" },
      { columna: 2, valor: "2" },
    ]);
    expect(r.sinColumna).toEqual([]);
  });

  it("sin valor va en cero cuando cero es verdad", () => {
    // Despacho y rotura: un producto sin renglón despachó cero, y eso es un dato.
    const r = celdasDeResumen(ENCABEZADOS, [CAL, FILLER], { "p-cal": 18 }, { siFalta: "cero" });
    expect(r.celdas).toContainEqual({ columna: 2, valor: "0" });
  });

  /**
   * Producción: un producto que no está en el mapa es uno que `soloLoCalculado`
   * dejó afuera porque no se pudo calcular. Un 0 ahí devuelve por la ventana el
   * mismo dato falso que el módulo vino a sacar — quien mira la planilla no
   * distingue "no produjo" de "no se sabe".
   */
  it("sin valor queda vacio cuando el cero seria mentira", () => {
    const r = celdasDeResumen(ENCABEZADOS, [CAL, FILLER], { "p-cal": 18 }, { siFalta: "vacio" });
    expect(r.celdas).toContainEqual({ columna: 2, valor: "" });
  });

  it("un cero explicito se escribe cero aunque siFalta sea vacio", () => {
    const r = celdasDeResumen(ENCABEZADOS, [CAL, FILLER], { "p-cal": 18, "p-filler": 0 }, { siFalta: "vacio" });
    expect(r.celdas).toContainEqual({ columna: 2, valor: "0" });
  });

  /** Null en nombre_planilla es una decisión, no un dato faltante. */
  it("un producto que no se exporta no ocupa columna ni se reporta", () => {
    const r = celdasDeResumen(ENCABEZADOS, [CAL, INTERNO], { "p-cal": 1, "p-interno": 9 });
    expect(r.celdas).toEqual([{ columna: 1, valor: "1" }]);
    expect(r.sinColumna).toEqual([]);
  });

  /** Si la planilla no tiene esa columna no se escribe en la de al lado. */
  it("un producto cuya columna no existe se informa y no se escribe", () => {
    const nuevo = producto("p-nuevo", "Bolsones de Magnesio", 4);
    const r = celdasDeResumen(ENCABEZADOS, [CAL, nuevo], { "p-cal": 1, "p-nuevo": 5 });
    expect(r.celdas).toEqual([{ columna: 1, valor: "1" }]);
    expect(r.sinColumna).toEqual(["Bolsones de Magnesio"]);
  });

  it("solo mira dentro de la ventana que se le pasa", () => {
    // Los nombres se repiten en Resumen Rotura: el segundo bloque arranca en 3.
    const conDosBloques = ["FECHA", "Bolsones de Cal", "Bolsones de Filler",
                           "Bolsones de Cal", "Bolsones de Filler"];
    const r = celdasDeResumen(conDosBloques, [CAL], { "p-cal": 7 }, { desde: 3 });
    expect(r.celdas).toEqual([{ columna: 3, valor: "7" }]);
  });
});

describe("el porcentaje de rotura", () => {
  it("es rotura sobre produccion", () => {
    expect(porcentajeDeRotura(1, 50)).toBe("0.02");
  });

  it("sin produccion y sin rotura es cero", () => {
    expect(porcentajeDeRotura(0, 0)).toBe("0");
  });

  /**
   * Hoy el script devuelve 0 acá, y un 0 dice "no hubo roturas" cuando las hubo.
   * Vacío dice lo que pasa: no hay porcentaje posible. La rotura en unidades
   * está en el bloque de al lado, y la pantalla del SdG la muestra.
   */
  it("con roturas y sin produccion queda vacio, no cero", () => {
    expect(porcentajeDeRotura(3, 0)).toBe("");
  });
});
```

- [ ] **Paso 2: Correrlo y ver que falla**

```bash
npx vitest run lib/produccion/planilla.test.ts
```

Esperado: FAIL, `Failed to resolve import "./planilla"`.

- [ ] **Paso 3: Implementar**

Crear `lib/produccion/planilla.ts`:

```ts
import { fechaDeSheets } from "@/lib/core/fechaDeSheets";
import type { Producto } from "./types";

/**
 * Armar las filas de los resúmenes de la planilla. Sin red: todo lo que decide
 * dónde va cada número está acá para poder probarlo, y `espejo.ts` sólo lee,
 * llama y escribe.
 *
 * LA PLANILLA, RELEVADA
 *
 * Las tres pestañas de resumen tienen los encabezados en la **fila 4** y las
 * fechas en la columna A, de la **fila 5 a la 34** (treinta días: los meses de
 * 31 no entran, y eso se informa en vez de adivinarse).
 *
 * `Resumen Rotura` tiene además un segundo bloque con los porcentajes que
 * arranca en la columna S, marcado en la fila 3 con "% ROTURA / PRODUCCIÓN".
 * **Los nombres de los productos se repiten en los dos bloques**, así que buscar
 * el nombre en toda la fila de encabezados devolvería siempre el primero: por eso
 * `celdasDeResumen` recibe una ventana.
 */

/**
 * En qué fila de la pestaña va una fecha, o `null` si no tiene fila.
 *
 * Se busca por la fecha y no contando: contar da bien mientras la planilla esté
 * completa y da mal justo el día que le falta una fila.
 */
export function filaDeLaFecha(
  columnaA: readonly string[][],
  fecha: string,
  primeraFila: number
): number | null {
  for (let i = 0; i < columnaA.length; i++) {
    if (fechaDeSheets(columnaA[i]?.[0]) === fecha) return primeraFila + i;
  }
  return null;
}

/** Dónde arranca el bloque de porcentajes, según el marcador de la fila 3. */
export function comienzoDelBloqueDePorcentaje(fila3: readonly string[]): number | null {
  const i = fila3.findIndex((c) => String(c ?? "").includes("%"));
  return i === -1 ? null : i;
}

export interface CeldaDeResumen {
  /** Índice de columna en base 0: A = 0. */
  columna: number;
  valor: string;
}

export interface FilaDeResumen {
  celdas: CeldaDeResumen[];
  /** Productos exportables cuya columna la planilla no tiene. No se adivina. */
  sinColumna: string[];
}

export interface OpcionesDeResumen {
  /** Primera columna del bloque, en base 0. Por defecto 1 (la B). */
  desde?: number;
  /** Primera columna ya fuera del bloque. Por defecto, el largo de los encabezados. */
  hasta?: number;
  /**
   * Qué escribir cuando el producto no tiene valor en el mapa. Por defecto `"cero"`.
   *
   * `"cero"` para **despacho y rotura**: un producto sin renglón de despacho
   * despachó cero, y eso es cierto.
   *
   * `"vacio"` para **producción**: un producto que no está en el mapa es uno que
   * `soloLoCalculado` dejó afuera porque no se pudo calcular —falta el parte
   * anterior, o falta un turno del día—. Un 0 ahí devuelve por la ventana
   * exactamente el dato falso que el módulo vino a sacar: quien mira la planilla
   * no distingue "no produjo" de "no se sabe".
   *
   * Ojo con la diferencia: esto es para el producto **ausente** del mapa. Un
   * cero explícito se escribe cero siempre, porque es una medición.
   */
  siFalta?: "cero" | "vacio";
}

export function celdasDeResumen(
  encabezados: readonly string[],
  productos: readonly Producto[],
  valores: Readonly<Record<string, number | string>>,
  opciones: OpcionesDeResumen = {}
): FilaDeResumen {
  const desde = opciones.desde ?? 1;
  const hasta = opciones.hasta ?? encabezados.length;
  const siFalta = opciones.siFalta ?? "cero";

  const celdas: CeldaDeResumen[] = [];
  const sinColumna: string[] = [];

  for (const p of productos) {
    // Null es una decisión: este producto no se exporta. No es un faltante.
    if (!p.nombre_planilla) continue;

    let columna = -1;
    for (let i = desde; i < hasta; i++) {
      if (String(encabezados[i] ?? "").trim() === p.nombre_planilla.trim()) {
        columna = i;
        break;
      }
    }

    if (columna === -1) {
      sinColumna.push(p.nombre_planilla);
      continue;
    }

    const v = valores[p.id];
    celdas.push({
      columna,
      valor: v === undefined ? (siFalta === "vacio" ? "" : "0") : String(v),
    });
  }

  return { celdas, sinColumna };
}

/**
 * El % de rotura de un producto.
 *
 * Hoy el Apps Script devuelve 0 cuando la producción es 0, y un 0 en esa celda
 * dice "no hubo roturas" cuando sí las hubo. Vacío dice lo que realmente pasa:
 * no hay porcentaje posible. Las unidades rotas están en el bloque de al lado.
 */
export function porcentajeDeRotura(rotura: number, produccion: number): string {
  if (produccion > 0) return String(rotura / produccion);
  return rotura === 0 ? "0" : "";
}
```

- [ ] **Paso 4: Correr el test y verlo pasar**

```bash
npx vitest run lib/produccion/planilla.test.ts
```

Esperado: PASS, 12 tests.

- [ ] **Paso 5: Commit**

```bash
git add lib/produccion/planilla.ts lib/produccion/planilla.test.ts
git commit -m "feat(produccion): las celdas de los resumenes, con la fila buscada por fecha"
```

---

# Parte 3 — Permisos, lectura y espejo

**Estas tareas necesitan las migraciones de la tarea 1 corridas.**

## Tarea 8: `auth.ts`

**Archivos:**
- Crear: `lib/produccion/auth.ts`

Calcado de `lib/inventario/auth.ts`, que es el molde vigente. Sin tests: es una consulta, y lo que decide (`nivelEnModulo`) ya está probado en el núcleo.

- [ ] **Paso 1: Escribir el archivo**

Crear `lib/produccion/auth.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { nivelEnModulo } from "@/lib/core/access";
import type { Rol, UsuarioModulo } from "@/lib/core/types";

/**
 * Permisos del módulo Producción.
 *
 *   lectura  ve los partes y los resúmenes
 *   edicion  además carga y corrige partes
 *   admin    además da de alta y edita productos del catálogo
 *
 * En la base los espejan `tiene_acceso_produccion()`,
 * `puede_editar_produccion()` y `es_admin_produccion()`. Las dos mitades tienen
 * que decir lo mismo: es lo que la 029 tuvo que corregir en Mantenimiento cuando
 * un `admin_sistema` veía los botones y RLS le devolvía listas vacías.
 */

export async function nivelProduccionDe(
  supabase: SupabaseClient,
  userId: string
): Promise<UsuarioModulo["nivel"] | null> {
  const { data: usuario } = await supabase
    .from("usuarios")
    .select("rol")
    .eq("id", userId)
    .single();
  if (!usuario) return null;

  const { data: grants } = await supabase
    .from("usuario_modulos")
    .select("id, usuario_id, modulo, nivel")
    .eq("usuario_id", userId);

  return nivelEnModulo(usuario.rol as Rol, (grants ?? []) as UsuarioModulo[], "produccion");
}

/** Acceso al módulo, con cualquier nivel. Hace falta donde se usa el cliente admin: ahí RLS no corre. */
export async function tieneAccesoProduccion(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  return (await nivelProduccionDe(supabase, userId)) !== null;
}

/** Cargar y corregir partes. */
export async function puedeEditarProduccion(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const nivel = await nivelProduccionDe(supabase, userId);
  return nivel === "edicion" || nivel === "admin";
}

/** Dar de alta y editar productos del catálogo. */
export async function esAdminProduccion(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  return (await nivelProduccionDe(supabase, userId)) === "admin";
}
```

- [ ] **Paso 2: Comprobar que compila**

```bash
npx tsc --noEmit
```

- [ ] **Paso 3: Commit**

```bash
git add lib/produccion/auth.ts
git commit -m "feat(produccion): los tres niveles, espejando las funciones de la base"
```

---

## Tarea 9: `consultas.ts` — traer un parte y el anterior

**Archivos:**
- Crear: `lib/produccion/consultas.ts`

- [ ] **Paso 1: Escribir el archivo**

Crear `lib/produccion/consultas.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import type { ClaveDeParte } from "./turnos";
import type { Despacho, Parte, Producto } from "./types";

/**
 * Traer de la base lo que las pantallas y las rutas necesitan.
 *
 * Dos partes por día con diez renglones cada uno son ~7.300 despachos al año.
 * **PostgREST corta en 1000 y no avisa**, así que todo lo que barra despachos va
 * por `traerTodo()`, y los filtros van por rango de fecha y nunca por un `.in()`
 * de muchos ids: esa URL PostgREST la rechaza con un 400 sin decir por qué.
 *
 * Los `select()` van literales y no armados en una variable: la cadena en una
 * variable pierde la inferencia de tipos de Supabase.
 */

export async function traerProductos(
  db: SupabaseClient,
  { soloActivos = true } = {}
): Promise<Producto[]> {
  let q = db
    .from("produccion_productos")
    .select("id, nombre, familia, envase, kg_por_unidad, nombre_planilla, orden, activo")
    .order("orden");
  if (soloActivos) q = q.eq("activo", true);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Producto[];
}

export interface ParteCompleto {
  parte: Parte;
  deposito: Record<string, number>;
  despachos: Despacho[];
}

/** Un parte con su depósito y sus renglones, o `null` si ese turno no está cargado. */
export async function traerParte(
  db: SupabaseClient,
  clave: ClaveDeParte
): Promise<ParteCompleto | null> {
  const { data: parte, error } = await db
    .from("produccion_partes")
    .select(
      "id, fecha, turno, capataz_raw, capataz_id, observaciones, tareas_limpieza, recuento_bolsones, sheets_pendiente, sheets_pendiente_en"
    )
    .eq("fecha", clave.fecha)
    .eq("turno", clave.turno)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!parte) return null;

  const filas = await traerTodo<{ producto_id: string; cantidad: number }>((desde, hasta) =>
    db
      .from("produccion_deposito")
      .select("producto_id, cantidad")
      .eq("parte_id", parte.id)
      .range(desde, hasta)
  );

  const despachos = await traerTodo<Despacho>((desde, hasta) =>
    db
      .from("produccion_despachos")
      .select(
        "id, parte_id, orden, equipo_raw, cliente_raw, producto_id, producto_raw, kilos, bultos, envase_raw, pallets_cantidad, pallets_tipo, rotura_bolsa, rotura_bolson"
      )
      .eq("parte_id", parte.id)
      .order("orden")
      .range(desde, hasta)
  );

  const deposito: Record<string, number> = {};
  for (const f of filas) deposito[f.producto_id] = Number(f.cantidad);

  return { parte: parte as Parte, deposito, despachos };
}

/**
 * El depósito de un parte, o `null` si ese parte no existe.
 *
 * El `null` es el dato: es lo que hace que la producción se informe como no
 * calculable en vez de salir de una resta contra cero.
 */
export async function traerDepositoDe(
  db: SupabaseClient,
  clave: ClaveDeParte
): Promise<Record<string, number> | null> {
  const completo = await traerParte(db, clave);
  return completo ? completo.deposito : null;
}

export interface DiaArmado {
  /** Los partes cargados ese día, para poder anotarles el pendiente. */
  ids: string[];
  productos: Producto[];
  produccion: Record<string, number>;
  despacho: Record<string, number>;
  rotura: Record<string, number>;
}

/**
 * El día entero, listo para exportar.
 *
 * Lo usan la ruta que guarda un parte y la que reintenta un pendiente. Está acá
 * y no en una de las dos porque hacían exactamente lo mismo, y dos copias de una
 * cuenta es cómo se corrige una sola.
 *
 * Lo que no se puede calcular **no se exporta**: `soloLoCalculado` deja afuera
 * los productos de un turno al que le falta el parte anterior. Escribir un cero
 * en la planilla sería poner allá el mismo dato falso que el módulo vino a sacar.
 */
export async function armarElDia(db: SupabaseClient, fecha: string): Promise<DiaArmado> {
  const productos = await traerProductos(db);

  const ids: string[] = [];
  // Un turno que no está cargado entra como `null`, no se saltea: es la única
  // forma de que `produccionDelDia` distinga "el turno produjo cero" de "el
  // turno no existe". Sin eso, un día con sólo la mañana cargada se exporta
  // como si fuera el día entero.
  const porTurno: (ProduccionPorProducto | null)[] = [];
  const despacho: Record<string, number> = {};
  const rotura: Record<string, number> = {};

  for (const turno of TURNOS) {
    const completo = await traerParte(db, { fecha, turno });
    if (!completo) {
      porTurno.push(null);
      continue;
    }
    ids.push(completo.parte.id);

    const totales = totalesDeDespacho(completo.despachos);
    const roturas = roturaTotal(totales);

    for (const [id, v] of Object.entries(totales.despachado)) {
      despacho[id] = (despacho[id] ?? 0) + v;
    }
    for (const [id, v] of Object.entries(roturas)) {
      rotura[id] = (rotura[id] ?? 0) + v;
    }

    porTurno.push(
      produccionDelTurno({
        deposito: completo.deposito,
        depositoAnterior: await traerDepositoDe(db, parteAnterior({ fecha, turno })),
        despachado: totales.despachado,
        rotura: roturas,
      })
    );
  }

  return {
    ids,
    productos,
    produccion: soloLoCalculado(produccionDelDia(porTurno)),
    despacho,
    rotura,
  };
}
```

Los imports que hay que agregar arriba del archivo:

```ts
import { TURNOS, parteAnterior } from "./turnos";
import { totalesDeDespacho, roturaTotal } from "./despachos";
import {
  produccionDelTurno,
  produccionDelDia,
  soloLoCalculado,
  type ProduccionPorProducto,
} from "./produccion";
```

- [ ] **Paso 2: Comprobar que compila**

```bash
npx tsc --noEmit
```

- [ ] **Paso 3: Commit**

```bash
git add lib/produccion/consultas.ts
git commit -m "feat(produccion): las consultas del modulo, paginadas desde el primer dia"
```

---

## Tarea 10: `espejo.ts` — escribir los resúmenes

**Archivos:**
- Crear: `lib/produccion/espejo.ts`
- Modificar: `docs/VARIABLES-VERCEL.md`

- [ ] **Paso 1: Escribir el archivo**

Crear `lib/produccion/espejo.ts`:

```ts
import { leerValores, escribirCeldas } from "@/lib/core/sheets";
import {
  celdasDeResumen,
  comienzoDelBloqueDePorcentaje,
  filaDeLaFecha,
  porcentajeDeRotura,
} from "./planilla";
import type { Producto } from "./types";

/**
 * Escribir en la planilla el día que se acaba de cargar.
 *
 * Acá manda el sistema, no la planilla: es la diferencia con Compras. Calidad
 * carga en el SdG y la planilla queda como el lugar donde miran los que no
 * entran, así que esto es una exportación de una sola dirección. La hoja
 * `Carga Diaria` y el botón de Apps Script desaparecen; `Histórico` también,
 * porque existía nada más para que el script supiera el stock del día anterior.
 *
 * **No lanza: devuelve qué pasó.** Quien lo llama anota el pendiente con lo que
 * dijo Google sin traducir, y se lo dice a quien guardó. Un fallo de escritura
 * no es un `console.warn`: eso costó una tarde entera en Compras.
 */

const PLANILLA = () => process.env.GOOGLE_SHEETS_PRODUCCION_ID ?? "";
const TAB_PRODUCCION = () => process.env.GOOGLE_SHEETS_PRODUCCION_TAB_PROD ?? "Resumen Producción";
const TAB_DESPACHO = () => process.env.GOOGLE_SHEETS_PRODUCCION_TAB_DESP ?? "Resumen Despacho";
const TAB_ROTURA = () => process.env.GOOGLE_SHEETS_PRODUCCION_TAB_ROT ?? "Resumen Rotura";

/** Los encabezados están en la fila 4 y las fechas arrancan en la 5. */
const FILA_ENCABEZADOS = 4;
const PRIMERA_FILA = 5;
const ULTIMA_FILA = 34;

export interface DiaAEspejar {
  /** "YYYY-MM-DD" */
  fecha: string;
  productos: Producto[];
  produccion: Record<string, number>;
  despacho: Record<string, number>;
  rotura: Record<string, number>;
}

export interface ResultadoEspejo {
  ok: boolean;
  /** Qué dijo Google, sin traducir. Un diagnóstico que no se distingue de otro no sirve. */
  error?: string;
}

export async function espejarDia(dia: DiaAEspejar): Promise<ResultadoEspejo> {
  const planilla = PLANILLA();
  if (!planilla) {
    return { ok: false, error: "Falta configurar GOOGLE_SHEETS_PRODUCCION_ID" };
  }

  try {
    const celdas: { pestana: string; columna: number; fila: number; valor: string }[] = [];
    const problemas: string[] = [];

    // El tercer elemento es lo que va cuando el producto no está en el mapa.
    // Producción va vacío: ausente ahí significa "no se pudo calcular", y un 0
    // en la planilla sería el dato falso que este módulo vino a sacar. Despacho
    // y rotura van en cero, porque ahí ausente sí significa cero.
    for (const [pestana, valores, siFalta] of [
      [TAB_PRODUCCION(), dia.produccion, "vacio"],
      [TAB_DESPACHO(), dia.despacho, "cero"],
      [TAB_ROTURA(), dia.rotura, "cero"],
    ] as const) {
      const encabezados = (await leerValores(planilla, `${pestana}!A${FILA_ENCABEZADOS}:BZ${FILA_ENCABEZADOS}`))[0] ?? [];
      const columnaA = await leerValores(
        planilla,
        `${pestana}!A${PRIMERA_FILA}:A${ULTIMA_FILA}`,
        { sinFormato: true }
      );

      const fila = filaDeLaFecha(columnaA, dia.fecha, PRIMERA_FILA);
      // No se adivina la fila: los resúmenes llegan hasta el día 30, así que
      // cualquier 31 cae acá, y escribir "la que parece" pisa otro día.
      if (fila === null) {
        problemas.push(`La pestaña "${pestana}" no tiene fila para el ${dia.fecha}`);
        continue;
      }

      // El bloque de unidades termina donde arranca el de porcentajes, si lo hay.
      const comienzoPct = comienzoDelBloqueDePorcentaje(encabezados);
      const hasta = comienzoPct ?? encabezados.length;

      const r = celdasDeResumen(encabezados, dia.productos, valores, { desde: 1, hasta, siFalta });
      for (const c of r.celdas) celdas.push({ pestana, columna: c.columna, fila, valor: c.valor });
      for (const n of r.sinColumna) {
        problemas.push(`La pestaña "${pestana}" no tiene columna para "${n}"`);
      }

      // El segundo bloque de Resumen Rotura: el % de cada producto.
      if (pestana === TAB_ROTURA() && comienzoPct !== null) {
        const pct: Record<string, string> = {};
        for (const p of dia.productos) {
          pct[p.id] = porcentajeDeRotura(dia.rotura[p.id] ?? 0, dia.produccion[p.id] ?? 0);
        }
        const rp = celdasDeResumen(encabezados, dia.productos, pct, {
          desde: comienzoPct,
          hasta: encabezados.length,
        });
        for (const c of rp.celdas) celdas.push({ pestana, columna: c.columna, fila, valor: c.valor });
      }
    }

    if (problemas.length > 0) return { ok: false, error: problemas.join("; ") };

    await escribirCeldas(planilla, celdas);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

- [ ] **Paso 2: Documentar las variables**

En `docs/VARIABLES-VERCEL.md`, agregar las cuatro con el mismo formato que usan las de Inventario:

```
GOOGLE_SHEETS_PRODUCCION_ID        El id de la planilla de Producción. Sin esto el espejo no escribe y deja pendiente.
GOOGLE_SHEETS_PRODUCCION_TAB_PROD  Pestaña del resumen de producción. Por defecto "Resumen Producción".
GOOGLE_SHEETS_PRODUCCION_TAB_DESP  Pestaña del resumen de despacho.  Por defecto "Resumen Despacho".
GOOGLE_SHEETS_PRODUCCION_TAB_ROT   Pestaña del resumen de rotura.    Por defecto "Resumen Rotura".
```

La planilla tiene que estar compartida como **editor** con la cuenta de servicio del SdG, igual que las de OT, OS, comparativas y almacén.

- [ ] **Paso 3: Comprobar que compila y que los tests siguen pasando**

```bash
npx tsc --noEmit
npm test
```

Esto no se puede probar en local: las credenciales de Google no están acá. Se verifica en el deploy, en la tarea 19.

- [ ] **Paso 4: Commit**

```bash
git add lib/produccion/espejo.ts docs/VARIABLES-VERCEL.md
git commit -m "feat(produccion): el espejo a los tres resumenes de la planilla"
```

---

# Parte 4 — Las rutas

## Tarea 11: Guardar un parte

**Archivos:**
- Crear: `app/api/produccion/partes/route.ts`

- [ ] **Paso 1: Escribir la ruta**

Crear `app/api/produccion/partes/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { indiceDeCatalogo, elQueNombra } from "@/lib/core/catalogo";
import { puedeEditarProduccion } from "@/lib/produccion/auth";
import { esTurno } from "@/lib/produccion/turnos";
import { armarElDia } from "@/lib/produccion/consultas";
import { espejarDia } from "@/lib/produccion/espejo";

/**
 * Guardar el parte de un turno, y exportar el día a la planilla.
 *
 * El espejo **no corre en segundo plano**. La regla del repo es que toda ruta
 * que toque un campo que se exporta tiene que exportar, y si no puede, dejar el
 * pendiente anotado: cambiar un número sin escribirlo en la planilla es una
 * divergencia que no avisa. Mandarlo a `after()` haría que su fallo terminara en
 * un log que nadie mira.
 *
 * Se exporta **el día entero**, no el turno: los resúmenes son diarios, y el
 * turno recién cargado cambia el total del día.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarProduccion(supabase, user.id))) {
    return NextResponse.json(
      { error: "Tu usuario no tiene nivel de edición en Producción" },
      { status: 403 }
    );
  }

  const b = await cuerpoJson(request);
  const fecha = String(b?.fecha ?? "").trim();
  const turno = b?.turno;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return NextResponse.json({ error: "La fecha tiene que ser YYYY-MM-DD" }, { status: 400 });
  }
  if (!esTurno(turno)) {
    return NextResponse.json({ error: "El turno tiene que ser 4_12 o 12_20" }, { status: 400 });
  }

  const admin = createAdminClient();
  const texto = (v: unknown) => String(v ?? "").trim() || null;
  const numero = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

  // ── 0. El capataz ──────────────────────────────────────────
  // Lo que dice el papel se guarda siempre. El enlace al empleado se resuelve
  // sólo si el nombre lo identifica **con certeza**: `elQueNombra` devuelve null
  // cuando no existe y también cuando dos empleados comparten nombre, y un
  // empate no resuelve a ninguno. Enlazar al que se le parece deja el dato en el
  // lugar que no es y no se nota nunca.
  const capatazRaw = texto(b?.capataz_raw);
  let capatazId = texto(b?.capataz_id);
  if (!capatazId && capatazRaw) {
    const { data: empleados } = await admin.from("empleados").select("id, nombre");
    capatazId = elQueNombra(indiceDeCatalogo(empleados ?? []), capatazRaw).id;
  }

  // ── 1. El parte ────────────────────────────────────────────
  // El upsert va sobre la constraint (fecha, turno), que es completa: un índice
  // parcial no sirve como destino de ON CONFLICT.
  const { data: parte, error: errParte } = await admin
    .from("produccion_partes")
    .upsert(
      {
        fecha,
        turno,
        capataz_raw: capatazRaw,
        capataz_id: capatazId,
        observaciones: texto(b?.observaciones),
        tareas_limpieza: texto(b?.tareas_limpieza),
        recuento_bolsones: texto(b?.recuento_bolsones),
        cargado_por: user.id,
        actualizado_por: user.id,
        actualizado_en: new Date().toISOString(),
      },
      { onConflict: "fecha,turno" }
    )
    .select("id")
    .single();

  if (errParte || !parte) {
    return NextResponse.json(
      { error: errParte?.message ?? "No se pudo guardar el parte" },
      { status: 500 }
    );
  }

  // ── 2. El depósito ─────────────────────────────────────────
  // Se reemplaza entero: el parte es la foto del papel, no un incremental.
  //
  // Se espera **una fila por producto activo**, aunque valga 0. El despeje lee
  // un producto ausente como cero, así que un producto que está en el depósito
  // del turno anterior y falta en éste da una producción negativa sin motivo
  // aparente. Quien garantiza eso es el formulario; acá no se completa lo que
  // falte, porque inventar filas sería inventar mediciones.
  await admin.from("produccion_deposito").delete().eq("parte_id", parte.id);

  const deposito = Array.isArray(b?.deposito) ? b.deposito : [];
  if (deposito.length > 0) {
    const { error } = await admin.from("produccion_deposito").insert(
      deposito.map((d: { producto_id: string; cantidad: unknown }) => ({
        parte_id: parte.id,
        producto_id: d.producto_id,
        cantidad: Number(d.cantidad) || 0,
      }))
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // ── 3. Los renglones de despacho ───────────────────────────
  await admin.from("produccion_despachos").delete().eq("parte_id", parte.id);

  const renglones = Array.isArray(b?.despachos) ? b.despachos : [];
  if (renglones.length > 0) {
    const { error } = await admin.from("produccion_despachos").insert(
      renglones.map((d: Record<string, unknown>, i: number) => ({
        parte_id: parte.id,
        orden: i + 1,
        equipo_raw: texto(d.equipo_raw),
        cliente_raw: texto(d.cliente_raw),
        // Puede venir en null a propósito: el renglón "Otros" del papel, o un
        // nombre que no se reconoció. El texto crudo se guarda igual.
        producto_id: texto(d.producto_id),
        producto_raw: texto(d.producto_raw),
        kilos: numero(d.kilos),
        bultos: numero(d.bultos),
        envase_raw: texto(d.envase_raw),
        pallets_cantidad: numero(d.pallets_cantidad),
        pallets_tipo: texto(d.pallets_tipo),
        rotura_bolsa: Number(d.rotura_bolsa) || 0,
        rotura_bolson: Number(d.rotura_bolson) || 0,
      }))
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // ── 4. Exportar el día ─────────────────────────────────────
  // El día entero y no el turno: los resúmenes son diarios, y el turno recién
  // cargado cambia el total del día.
  const { productos, produccion, despacho, rotura } = await armarElDia(admin, fecha);
  const resultado = await espejarDia({ fecha, productos, produccion, despacho, rotura });

  await admin
    .from("produccion_partes")
    .update({
      sheets_pendiente: resultado.ok ? null : resultado.error,
      sheets_pendiente_en: resultado.ok ? null : new Date().toISOString(),
    })
    .eq("id", parte.id);

  return NextResponse.json({
    id: parte.id,
    planilla: resultado.ok ? "escrita" : "pendiente",
    // Sin traducir y a la vista: quien cargó tiene que poder distinguir este
    // fallo de cualquier otro.
    error_planilla: resultado.ok ? null : resultado.error,
  });
}
```

- [ ] **Paso 2: Comprobar que compila**

```bash
npx tsc --noEmit
```

- [ ] **Paso 3: Commit**

```bash
git add app/api/produccion/partes/route.ts
git commit -m "feat(produccion): guardar el parte y exportar el dia, con el pendiente anotado"
```

---

## Tarea 12: Reintentar los pendientes

**Archivos:**
- Crear: `app/api/produccion/planilla/reintentar/route.ts`

- [ ] **Paso 1: Escribir la ruta**

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeEditarProduccion } from "@/lib/produccion/auth";
import { armarElDia } from "@/lib/produccion/consultas";
import { espejarDia } from "@/lib/produccion/espejo";

/**
 * Reintentar la escritura de un día que quedó pendiente.
 *
 * Un pendiente casi siempre se arregla afuera —la planilla no tenía la fila del
 * 31, o falta la columna de un producto nuevo, o Google devolvió 429—, así que
 * el botón tiene que estar y no hace falta más que volver a intentar.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarProduccion(supabase, user.id))) {
    return NextResponse.json(
      { error: "Tu usuario no tiene nivel de edición en Producción" },
      { status: 403 }
    );
  }

  const b = await cuerpoJson(request);
  const fecha = String(b?.fecha ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return NextResponse.json({ error: "La fecha tiene que ser YYYY-MM-DD" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { ids, productos, produccion, despacho, rotura } = await armarElDia(admin, fecha);

  if (ids.length === 0) {
    return NextResponse.json({ error: `No hay partes cargados el ${fecha}` }, { status: 404 });
  }

  const resultado = await espejarDia({ fecha, productos, produccion, despacho, rotura });

  for (const id of ids) {
    await admin
      .from("produccion_partes")
      .update({
        sheets_pendiente: resultado.ok ? null : resultado.error,
        sheets_pendiente_en: resultado.ok ? null : new Date().toISOString(),
      })
      .eq("id", id);
  }

  return NextResponse.json({
    planilla: resultado.ok ? "escrita" : "pendiente",
    error_planilla: resultado.ok ? null : resultado.error,
  });
}
```

- [ ] **Paso 2: Comprobar**

```bash
npx tsc --noEmit
npm test
```

- [ ] **Paso 3: Commit**

```bash
git add app/api/produccion/planilla/reintentar/route.ts
git commit -m "feat(produccion): reintentar la escritura de un dia pendiente"
```

---

## Tarea 13: El catálogo de productos

**Archivos:**
- Crear: `app/api/produccion/productos/route.ts`

- [ ] **Paso 1: Escribir la ruta**

`GET` devuelve el catálogo con `tieneAccesoProduccion`; `POST` da de alta y `PATCH` edita, los dos con `esAdminProduccion`. Campos aceptados: `nombre`, `familia`, `envase`, `kg_por_unidad`, `nombre_planilla`, `orden`, `activo`. Un producto **no se borra**: se pone `activo: false`, porque los partes viejos lo referencian y una baja física los rompería.

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { esAdminProduccion, tieneAccesoProduccion } from "@/lib/produccion/auth";
import { traerProductos } from "@/lib/produccion/consultas";

const FAMILIAS = ["filler", "0_2", "cal", "otros"];
const ENVASES = ["bolsa", "bolson"];

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoProduccion(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Producción" }, { status: 403 });
  }
  return NextResponse.json({ productos: await traerProductos(supabase, { soloActivos: false }) });
}

export async function POST(request: Request) {
  return guardar(request, "alta");
}

export async function PATCH(request: Request) {
  return guardar(request, "edicion");
}

async function guardar(request: Request, modo: "alta" | "edicion") {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await esAdminProduccion(supabase, user.id))) {
    return NextResponse.json(
      { error: "Sólo un admin de Producción edita el catálogo" },
      { status: 403 }
    );
  }

  const b = await cuerpoJson(request);
  const nombre = String(b?.nombre ?? "").trim();
  if (modo === "alta" && !nombre) {
    return NextResponse.json({ error: "El producto necesita un nombre" }, { status: 400 });
  }
  if (b?.familia !== undefined && !FAMILIAS.includes(String(b.familia))) {
    return NextResponse.json({ error: `Familia inválida. Son: ${FAMILIAS.join(", ")}` }, { status: 400 });
  }
  if (b?.envase !== undefined && !ENVASES.includes(String(b.envase))) {
    return NextResponse.json({ error: `Envase inválido. Son: ${ENVASES.join(", ")}` }, { status: 400 });
  }

  const admin = createAdminClient();
  const campos = {
    ...(b?.nombre !== undefined && { nombre }),
    ...(b?.familia !== undefined && { familia: b.familia }),
    ...(b?.envase !== undefined && { envase: b.envase }),
    // Null es válido y significa "sin confirmar": el bolsón no tiene kilos
    // acordados todavía, y un número inventado apagaría la comprobación.
    ...(b?.kg_por_unidad !== undefined && {
      kg_por_unidad: b.kg_por_unidad === null || b.kg_por_unidad === "" ? null : Number(b.kg_por_unidad),
    }),
    // Null acá significa "no se exporta a la planilla", que es una decisión.
    ...(b?.nombre_planilla !== undefined && {
      nombre_planilla: String(b.nombre_planilla ?? "").trim() || null,
    }),
    ...(b?.orden !== undefined && { orden: Number(b.orden) }),
    ...(b?.activo !== undefined && { activo: Boolean(b.activo) }),
  };

  if (modo === "alta") {
    const { data, error } = await admin
      .from("produccion_productos")
      .insert({ orden: 0, familia: "otros", envase: "bolsa", ...campos })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ id: data.id });
  }

  const id = String(b?.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "Falta el id del producto" }, { status: 400 });

  const { error } = await admin.from("produccion_productos").update(campos).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id });
}
```

- [ ] **Paso 2: Comprobar y commitear**

```bash
npx tsc --noEmit
git add app/api/produccion/productos/route.ts
git commit -m "feat(produccion): el ABM del catalogo, con baja logica"
```

---

# Parte 5 — Las pantallas

Siguen las convenciones del repo: un `page.tsx` que es Server Component y trae los datos, y un `*Client.tsx` con la interacción. El estilo visual se copia de las pantallas de Inventario, que son las más nuevas.

## Tarea 14: La carga del parte

**Archivos:**
- Crear: `app/(app)/produccion/parte/[fecha]/[turno]/page.tsx`
- Crear: `app/(app)/produccion/parte/[fecha]/[turno]/ParteClient.tsx`

- [ ] **Paso 1: El Server Component**

```tsx
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelProduccionDe } from "@/lib/produccion/auth";
import { esTurno, parteAnterior, comoSeLeeElTurno } from "@/lib/produccion/turnos";
import { traerProductos, traerParte, traerDepositoDe } from "@/lib/produccion/consultas";
import ParteClient from "./ParteClient";

/**
 * La carga de un parte, en el orden del papel: cabecera y capataz, depósito
 * agrupado en Filler / 0-2 / Cal, renglones de despacho, y los tres textos.
 * Transcribir tiene que ser leer de arriba abajo, no saltar.
 */
export default async function PartePage({
  params,
}: {
  params: Promise<{ fecha: string; turno: string }>;
}) {
  const { fecha, turno } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !esTurno(turno)) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelProduccionDe(supabase, user.id);
  if (!nivel) redirect("/");

  const [productos, completo, depositoAnterior, empleados] = await Promise.all([
    traerProductos(supabase),
    traerParte(supabase, { fecha, turno }),
    traerDepositoDe(supabase, parteAnterior({ fecha, turno })),
    supabase.from("empleados").select("id, nombre").order("nombre"),
  ]);

  return (
    <ParteClient
      fecha={fecha}
      turno={turno}
      turnoLegible={comoSeLeeElTurno(turno)}
      puedeEditar={nivel === "edicion" || nivel === "admin"}
      productos={productos}
      parte={completo?.parte ?? null}
      deposito={completo?.deposito ?? {}}
      despachos={completo?.despachos ?? []}
      // Null acá es el dato que hace que la pantalla diga "no calculable" en vez
      // de mostrar una producción que sale de restar contra cero.
      depositoAnterior={depositoAnterior}
      parteAnterior={parteAnterior({ fecha, turno })}
      empleados={empleados.data ?? []}
    />
  );
}
```

- [ ] **Paso 2: El Client Component**

`ParteClient.tsx` recibe esas props y mantiene en estado el depósito (`Record<string, string>` por producto) y los renglones de despacho (un arreglo). Cuatro bloques, en el orden del papel:

1. **Cabecera** — fecha y turno como título, y un `<select>` de capataz sobre `empleados` más un campo de texto libre. El texto libre es el que se guarda siempre; el `select` sólo llena `capataz_id`.
2. **Depósito** — una fila por producto activo, agrupadas por `familia` con un encabezado por grupo (`Filler`, `0-2`, `Cal`, `Otros`). Cada fila muestra, además del input, la producción que se despeja en vivo con `produccionDelTurno()` sobre el estado actual: es el número que hoy aparece recién al día siguiente.
3. **Despachos** — una tabla que crece con un botón "Agregar renglón". Columnas: equipo, cliente, producto (`<select>` del catálogo, con la opción vacía "sin reconocer" que deja `producto_id` en null y guarda el texto), kilos, bultos, tipo de envase, pallets (cantidad y tipo), rotura bolsa y rotura bolsón. Debajo, los desajustes que devuelve `desajustesDeKilos()` como aviso ámbar — **no bloquean el guardado**.
4. **Textos** — tres `<textarea>`: observaciones, tareas de limpieza, recuento de bolsones.

Arriba de todo, cuando `depositoAnterior === null`, un aviso: *"No está cargado el parte anterior (`<fecha>` turno `<turno>`), así que la producción de este turno no se puede calcular"*, con enlace a ese parte.

El guardado hace `POST /api/produccion/partes` con el cuerpo que espera la tarea 11, y muestra la respuesta:

```tsx
const guardar = async () => {
  setGuardando(true);
  const res = await fetch("/api/produccion/partes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fecha, turno,
      capataz_raw: capatazRaw, capataz_id: capatazId || null,
      observaciones, tareas_limpieza: limpieza, recuento_bolsones: recuento,
      // Una entrada por **cada producto activo**, aunque el input esté vacío —
      // no sólo los que el usuario tocó. Si un producto falta, el despeje lee su
      // ausencia como cero y la producción sale como el negativo del stock
      // anterior, en rojo y sin motivo aparente.
      deposito: productos.map((p) => ({ producto_id: p.id, cantidad: deposito[p.id] ?? "0" })),
      despachos: renglones,
    }),
  });
  const json = await res.json();
  setGuardando(false);

  if (!res.ok) return setError(json.error ?? "No se pudo guardar");

  // El fallo de planilla se muestra con lo que dijo Google, sin traducir: es lo
  // único que permite distinguir "falta la fila del 31" de "falta el permiso".
  setAviso(
    json.planilla === "escrita"
      ? "Guardado y escrito en la planilla."
      : `Guardado, pero no llegó a la planilla: ${json.error_planilla}`
  );
};
```

- [ ] **Paso 3: Comprobar**

```bash
npx tsc --noEmit
npm test
```

- [ ] **Paso 4: Commit**

```bash
git add "app/(app)/produccion/parte"
git commit -m "feat(produccion): la pantalla de carga, en el orden del papel"
```

---

## Tarea 15: El día

**Archivos:**
- Crear: `app/(app)/produccion/page.tsx`
- Crear: `app/(app)/produccion/DiaClient.tsx`

- [ ] **Paso 1: El Server Component**

Toma la fecha de `searchParams` y cae en `hoyEnArgentina()` cuando no viene. Trae los dos partes del día, el depósito del parte anterior a cada uno, y calcula con `produccionDelTurno` / `produccionDelDia`.

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { nivelProduccionDe } from "@/lib/produccion/auth";
import { parteAnterior, TURNOS } from "@/lib/produccion/turnos";
import { traerProductos, traerParte, traerDepositoDe } from "@/lib/produccion/consultas";
import { totalesDeDespacho, roturaTotal } from "@/lib/produccion/despachos";
import { produccionDelTurno, produccionDelDia, type ProduccionPorProducto } from "@/lib/produccion/produccion";
import type { TotalesDeDespacho } from "@/lib/produccion/despachos";
import type { Despacho, Parte, Turno } from "@/lib/produccion/types";
import DiaClient from "./DiaClient";

export interface TurnoDelDia {
  turno: Turno;
  cargado: boolean;
  parte: Parte | null;
  despachos: Despacho[];
  totales: TotalesDeDespacho | null;
  faltaAnterior: boolean;
  /** `null` = el turno no está cargado. No es lo mismo que un turno sin productos. */
  produccion: ProduccionPorProducto | null;
}

export default async function ProduccionPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string }>;
}) {
  const { fecha: pedida } = await searchParams;
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(pedida ?? "") ? pedida! : hoyEnArgentina();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelProduccionDe(supabase, user.id);
  if (!nivel) redirect("/");

  const productos = await traerProductos(supabase);

  // Las dos ramas empujan la **misma forma**: un turno sin cargar no es un
  // objeto distinto, es el mismo con todo en vacío. Si las formas difieren, el
  // tipo que infiere TS es una unión y el cliente termina lleno de `in`.
  const turnos: TurnoDelDia[] = [];
  for (const turno of TURNOS) {
    const completo = await traerParte(supabase, { fecha, turno });

    if (!completo) {
      turnos.push({
        turno, cargado: false, parte: null, despachos: [],
        totales: null, faltaAnterior: false, produccion: null,
      });
      continue;
    }

    const totales = totalesDeDespacho(completo.despachos);
    const anterior = await traerDepositoDe(supabase, parteAnterior({ fecha, turno }));

    turnos.push({
      turno,
      cargado: true,
      parte: completo.parte,
      despachos: completo.despachos,
      totales,
      // `null` es el dato: sin el parte anterior no hay resta posible.
      faltaAnterior: anterior === null,
      produccion: produccionDelTurno({
        deposito: completo.deposito,
        depositoAnterior: anterior,
        despachado: totales.despachado,
        rotura: roturaTotal(totales),
      }),
    });
  }

  return (
    <DiaClient
      fecha={fecha}
      productos={productos}
      turnos={turnos}
      delDia={produccionDelDia(turnos.map((t) => t.produccion))}
      puedeEditar={nivel === "edicion" || nivel === "admin"}
    />
  );
}
```

- [ ] **Paso 2: El Client Component**

Un selector de fecha con flechas de día anterior y siguiente. Debajo, tres avisos cuando corresponda, todos con enlace a la acción que los resuelve:

- **Falta un parte** — *"El turno 4 a 12 no está cargado"*, con botón "Cargar".
- **Falta el parte anterior** — *"La producción del turno 4 a 12 no se puede calcular: falta el parte del 02/09 turno 12 a 20"*, con enlace a ese parte.
- **No llegó a la planilla** — el texto de `sheets_pendiente` tal cual, con botón "Reintentar" que hace `POST /api/produccion/planilla/reintentar` con la fecha.

Y la tabla del día: una fila por producto, agrupada por familia, con columnas *Producción T1*, *Producción T2*, *Producción del día*, *Despachado*, *Rotura bolsa*, *Rotura bolsón*.

Las tres formas de que una celda **no** tenga número, y cada una dice otra cosa:

| Estado | Qué muestra | Qué significa |
|---|---|---|
| `sin_parte_anterior` | `—` con el motivo al pasar el mouse | Falta el parte del turno previo: no hay contra qué restar |
| `dia_incompleto` | `—` en la columna del día | Falta un turno de este día. Los turnos que sí están muestran su número |
| turno sin cargar | la celda del turno vacía | Ese parte todavía no se transcribió |

Una producción **negativa** se muestra en rojo con la cuenta desglosada al pasar el mouse. No se recorta a cero: es un error de carga y hay que verlo.

- [ ] **Paso 3: Comprobar y commitear**

```bash
npx tsc --noEmit
git add "app/(app)/produccion/page.tsx" "app/(app)/produccion/DiaClient.tsx"
git commit -m "feat(produccion): la pantalla del dia, con los avisos que el Excel no da"
```

---

## Tarea 16: Los resúmenes del mes

**Archivos:**
- Crear: `app/(app)/produccion/resumenes/page.tsx`
- Crear: `app/(app)/produccion/resumenes/ResumenesClient.tsx`

- [ ] **Paso 1: El Server Component**

Recibe `?mes=YYYY-MM` (por defecto el mes de `hoyEnArgentina()`), trae todos los partes del rango con `traerTodo()` **filtrando por rango de fecha** (`.gte("fecha", primero).lte("fecha", ultimo)`) y nunca por un `.in()` de ids, y arma la matriz día × producto para producción, despacho y rotura, reusando exactamente las mismas funciones que la exportación: `totalesDeDespacho`, `roturaTotal`, `produccionDelTurno`, `produccionDelDia`.

Que la pantalla y la planilla salgan de las mismas funciones es el punto: si divergen, divergen las dos juntas y se nota.

- [ ] **Paso 2: El Client Component**

Tres tablas —producción, despacho, rotura— con una fila por día y una columna por producto, más una fila de totales del mes. En la de rotura, una segunda tabla con el porcentaje calculado con `porcentajeDeRotura()`; donde queda vacío se muestra las unidades rotas con la aclaración *"sin producción"*, que es la información que hoy se pierde detrás de un 0 %.

- [ ] **Paso 3: Comprobar y commitear**

```bash
npx tsc --noEmit
git add "app/(app)/produccion/resumenes"
git commit -m "feat(produccion): los resumenes del mes, calculados con las mismas funciones que exportan"
```

---

## Tarea 17: El catálogo

**Archivos:**
- Crear: `app/(app)/produccion/productos/page.tsx`
- Crear: `app/(app)/produccion/productos/ProductosClient.tsx`
- Modificar: `lib/core/nav.ts` (después del grupo de Inventario)

- [ ] **Paso 1: Las dos piezas**

`page.tsx` redirige a `/produccion` si `esAdminProduccion` es falso y trae el catálogo completo con `traerProductos(supabase, { soloActivos: false })`.

`ProductosClient.tsx` es una tabla editable con las columnas `nombre`, `familia`, `envase`, `kg_por_unidad`, `nombre_planilla`, `orden` y `activo`, y un botón de alta. Guarda contra `POST` / `PATCH /api/produccion/productos`.

Dos cosas que la pantalla tiene que decir, porque son las que se olvidan:

- `nombre_planilla` vacío significa **no se exporta**, y hay que escribirlo al lado del campo, no dejarlo como un vacío ambiguo.
- Un producto no se borra: se desactiva. Los partes viejos lo referencian.

- [ ] **Paso 2: Recién ahora, el menú**

Con esta pantalla ya existen las tres rutas del módulo, así que el grupo del menú deja de apuntar a 404. En `lib/core/nav.ts`, inmediatamente después del objeto del grupo `Inventario` y antes de `{ label: "Mis pedidos", ... }`:

```ts
  {
    label: "Producción",
    href: "/produccion",
    modulo: "produccion",
    // El día primero: es la pantalla que se abre para cargar el parte del turno
    // que acaba de terminar, que es el 95% de lo que se hace acá.
    children: [
      { label: "El día", href: "/produccion", modulo: "produccion" },
      { label: "Resúmenes", href: "/produccion/resumenes", modulo: "produccion" },
      { label: "Productos", href: "/produccion/productos", modulo: "produccion", soloAdmin: true },
    ],
  },
```

Antes de commitear, comprobar que las tres rutas existen de verdad: `ls "app/(app)/produccion" "app/(app)/produccion/resumenes" "app/(app)/produccion/productos"`. Un `admin_sistema` va a ver este menú apenas se despliegue, sin que nadie le conceda el módulo.

- [ ] **Paso 3: Comprobar y commitear**

```bash
npx tsc --noEmit
npm test
git add "app/(app)/produccion/productos" lib/core/nav.ts
git commit -m "feat(produccion): el catalogo de productos, y el modulo entra al menu"
```

---

## Tarea 18: La tarjeta del inicio

**Archivos:**
- Modificar: `app/(app)/InicioClient.tsx`
- Modificar: `app/api/home/resumen/route.ts`

- [ ] **Paso 1: El resumen**

En `app/api/home/resumen/route.ts`, sumar la clave `produccion` con dos números, calculados sólo si el usuario tiene acceso al módulo:

- `partesFaltantes`: de los últimos 7 días, cuántos de los 14 partes posibles no están cargados.
- `sinLlegarALaPlanilla`: `count` de `produccion_partes` con `sheets_pendiente` no nulo.

- [ ] **Paso 2: La tarjeta**

En `app/(app)/InicioClient.tsx`, sumar `produccion` al tipo del resumen y al objeto inicial de la línea 16, y una `<ModuloCard>` después de la de Inventario, con el mismo molde:

```tsx
{/* Lo que pide hacer algo es un parte que falta: la producción del turno
    siguiente no se puede calcular hasta que esté. Los que no llegaron a la
    planilla son la otra alarma: quien mira la planilla ve un día en blanco. */}
{tiene("produccion") && (
  <ModuloCard
    titulo="Producción"
    href="/produccion"
    color="#0E7490"
    icon={<IconFabrica />}
    hero={
      resumen?.produccion
        ? { label: "Partes sin cargar (7 días)", valor: resumen.produccion.partesFaltantes }
        : null
    }
    secundarias={
      resumen?.produccion
        ? [{ label: "Sin llegar a la planilla", valor: resumen.produccion.sinLlegarALaPlanilla }]
        : null
    }
  />
)}
```

Agregar `IconFabrica` al final del archivo, con el mismo formato que `IconCajas`.

- [ ] **Paso 3: Comprobar y commitear**

```bash
npx tsc --noEmit
npm test
git add "app/(app)/InicioClient.tsx" app/api/home/resumen/route.ts
git commit -m "feat(produccion): la tarjeta del inicio, con los partes que faltan"
```

---

# Parte 6 — Cierre

## Tarea 19: Verificación completa y documento del módulo

**Archivos:**
- Crear: `docs/PRODUCCION.md`
- Modificar: `CLAUDE.md` (la tabla de documentos por módulo)

- [ ] **Paso 1: La verificación entera**

Con el dev server **parado**:

```bash
npm test
npx tsc --noEmit
npm run build
```

Esperado: los tres en verde. `npm run lint` falla y no es tu cambio.

- [ ] **Paso 2: Escribir el documento del módulo**

`docs/PRODUCCION.md`, con lo que no se deduce del código: que la producción se despeja y por qué no se guarda; el mapeo entre el papel, el Excel y el catálogo tal como haya quedado; la estructura relevada de la planilla (encabezados en la fila 4, fechas de la 5 a la 34, el bloque de % de `Resumen Rotura` marcado en la fila 3); y que `Carga Diaria`, `Histórico` y el Apps Script quedaron fuera de uso.

- [ ] **Paso 3: Enlazarlo**

En la tabla "Antes de retomar un módulo, leer su documento" de `CLAUDE.md`, agregar la fila de Producción con el enlace al documento y al spec.

- [ ] **Paso 4: Commit y push**

```bash
git add docs/PRODUCCION.md CLAUDE.md
git commit -m "docs(produccion): el documento del modulo y su enlace"
git push
```

---

## Tarea 20: Puesta en marcha

Esto lo hace una persona, no el agente. Anotarlo y quedar a la espera.

- [ ] **El catálogo.** Calidad tiene que resolver, renglón por renglón, la correspondencia entre los ~15 renglones del papel, las 17 columnas del Excel y los productos reales. Recién con eso se carga `produccion_productos` — por PostgREST, que es DML. **No se inventa**: un producto enlazado al que se le parece suma su producción en la columna de otro y no se nota nunca.
- [ ] **Los kilos por unidad.** 25 la bolsa. El bolsón, a confirmar, y si es igual para todos.
- [ ] **Las dos columnas del despacho.** Confirmar con calidad qué va en *Productos y kilos* y qué en *Cantidad bolsa/bolsón*: en la foto relevada un número parece kilos y otro bultos.
- [ ] **La planilla.** Cargar `GOOGLE_SHEETS_PRODUCCION_ID` en Vercel, compartirla como **editor** con la cuenta de servicio, y ampliar los resúmenes a 31 filas — hoy llegan a 30 y cualquier día 31 va a quedar pendiente.
- [ ] **La primera escritura real, mirándola.** Verificar en la planilla que un decimal del bloque de % —por ejemplo `0.0189`— entra como número y no como texto. `escribirCeldas` usa `valueInputOption: USER_ENTERED`, que interpreta según el locale de la planilla; si la planilla es es-AR y el punto no se toma como decimal, cambiar `porcentajeDeRotura` para que devuelva coma y agregar el test.
- [ ] **Los permisos.** Dar de alta a quien carga con nivel `edicion` en el módulo Producción, desde Administración → Usuarios.
- [ ] **Apagar el Excel.** Recién cuando un mes entero haya salido bien por los dos caminos: dejar de usar `Carga Diaria` y quitar el botón, para que no queden dos fuentes escribiendo los mismos resúmenes.
