# Envases — plan de implementación

> **Para quien lo ejecute:** cada paso es una acción de 2 a 5 minutos. Los `- [ ]`
> son para ir tildando. El diseño está en
> [docs/superpowers/specs/2026-09-15-produccion-envases-design.md](../specs/2026-09-15-produccion-envases-design.md)
> y **conviene leerlo antes**: acá está el cómo, allá está el por qué.

**Objetivo:** espejar la planilla de stock de envases que lleva calidad, como
una sección del módulo Producción.

**Arquitectura:** la planilla manda (como Inventario, al revés que el resto de
Producción). El SdG lee catálogo y kardex, **no calcula el stock** —lo lee de la
columna que es fórmula—, y cuando alguien carga un movimiento desde la app lo
escribe en la planilla. Todo lo que decide algo vive en `lib/produccion/envases/`
y se prueba con vitest; las rutas y las pantallas no tienen tests.

**Herramientas:** Next.js 16 (App Router), Supabase, vitest, la cuenta de
servicio de Google que el repo ya usa.

---

## Antes de empezar

Leer, en este orden:

1. El spec (link arriba).
2. `supabase/migrations/README.md` — las ocho trampas. Dos aplican acá.
3. `lib/inventario/planilla.ts`, `espejo.ts` y `sincronizar.ts` — son el molde.
   Este módulo es ese módulo con otras columnas.
4. La sección "Puede haber otra sesión en el mismo árbol" de `CLAUDE.md`.

**Dos reglas de este repo que se rompen solas si no se piensan:**

- **Nunca `git add -A`,** y **nunca `git commit` a secas**: el índice puede
  tener staged el trabajo de otra sesión y se lo lleva entero. Todos los
  commits de este plan usan `git commit --only <rutas>`.
- **Las migraciones las corre una persona.** El agente escribe el archivo y
  espera. No hay CLI.

---

## Mapa de archivos

| Archivo | De qué se ocupa |
|---|---|
| `supabase/migrations/<ts>_produccion_envases.sql` | Las cinco tablas, sus índices y RLS |
| `lib/produccion/envases/planilla.ts` | Leer las cuatro pestañas. Sin IO: recibe `unknown[][]` |
| `lib/produccion/envases/informe.ts` | El resumen por período y grupo |
| `lib/produccion/envases/espejo.ts` | Qué celdas se escriben, y escribirlas |
| `lib/produccion/envases/sincronizar.ts` | Traer de la planilla. Es también la carga inicial |
| `app/api/produccion/envases/sync/route.ts` | POST: traer de la planilla |
| `app/api/produccion/envases/movimientos/route.ts` | POST: alta, con espejo |
| `app/(app)/produccion/envases/…` | Las cuatro pantallas |

`planilla.ts` no toca Google y `espejo.ts` separa "qué celdas" de "escribirlas":
es lo que hace que las dos partes que deciden algo se puedan probar.

---

## Tarea 1: La migración

Va primera porque **bloquea**: hasta que el usuario la aplique a mano en el
editor SQL de Supabase, nada de lo que toca la base se puede probar de verdad.
Las tareas 2 y 3 son puras y se pueden hacer mientras tanto.

**Archivos:**
- Crear: `supabase/migrations/<timestamp>_produccion_envases.sql`

- [ ] **Paso 1: Generar el archivo con marca de tiempo**

El nombre lo pone el script, no vos: dos sesiones que eligen "el próximo número
libre" chocan.

```bash
npm run migracion "produccion envases"
```

- [ ] **Paso 2: Escribir el DDL**

**No hay valor de enum nuevo** —usa el `'produccion'` que ya existe— así que
esto va entero en un archivo. La trampa `55P04` no aplica.

```sql
-- ============================================================
-- SdG — Envases: el stock de envases que lleva calidad
--
-- Sección de Producción, no módulo nuevo: usa tiene_acceso_produccion(),
-- puede_editar_produccion() y es_admin_produccion(), que ya existen. Por eso
-- no hay valor de enum nuevo y esto entra en un solo archivo.
--
-- LA PLANILLA MANDA, al revés que el resto de Producción. Su planilla es la
-- del almacén clonada: el stock del listado es una fórmula
-- (inicial + Σ entradas − Σ salidas) sobre el kardex, así que es el stock
-- consolidado correcto y el SdG lo LEE en vez de calcularlo.
-- Ver docs/superpowers/specs/2026-09-15-produccion-envases-design.md
-- ============================================================

-- ── 1. El catálogo ───────────────────────────────────────────

create table if not exists produccion_envases_articulos (
  id               uuid primary key default gen_random_uuid(),
  -- Con los ceros a la izquierda ("00001"). Texto y no número: un cero perdido
  -- lo vuelve otro artículo.
  codigo           text not null unique,
  descripcion      text not null,
  ubicacion        text,
  proveedores_ref  text,

  -- Lo que dice la columna K del kardex, que es con lo que la planilla agrupa
  -- bien. Null cuando el artículo no tiene movimientos —la K sale del kardex—
  -- o cuando sus filas dicen dos grupos distintos. Se informa, no se adivina.
  grupo            text,

  stock_inicial    numeric not null default 0,
  -- Lo que dijo la columna de fórmula la última vez que se la leyó. No es un
  -- cálculo del SdG. Ver stock_sincronizado_en: un número sin fecha se lee
  -- como si fuera de ahora.
  stock_actual     numeric not null default 0,
  stock_seguridad  numeric not null default 0,
  faltante         numeric generated always as
                   (greatest(stock_seguridad - stock_actual, 0)) stored,

  stock_sincronizado_en timestamptz,
  sheets_fila      integer,

  activo           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists produccion_envases_articulos_grupo_idx
  on produccion_envases_articulos (grupo);
create index if not exists produccion_envases_articulos_faltante_idx
  on produccion_envases_articulos (faltante) where faltante > 0;

create trigger produccion_envases_articulos_updated_at
  before update on produccion_envases_articulos
  for each row execute function set_updated_at();

comment on column produccion_envases_articulos.stock_actual is
  'Lo que dijo la planilla la última vez que se sincronizó, no un cálculo del SdG.';
comment on column produccion_envases_articulos.grupo is
  'El grupo de envase, de la columna K del kardex. Null cuando no se lo reconoce con certeza.';

-- ── 2. El kardex ─────────────────────────────────────────────
--
-- UN MOVIMIENTO NO ES tipo+cantidad, como en Inventario. Es una fila con
-- cuatro números: la planilla tiene 4 filas con entrada y salida a la vez, y
-- la rotura y el despacho conviven con la salida en la misma fila. Partirlas
-- daría varios movimientos por una fila de planilla y rompería el sheets_fila
-- único, que es lo que hace que reimportar no duplique.
--
-- ROTURA y DESPACHO se guardan y NO descuentan stock, igual que la planilla:
-- medido, en 950 de 1.309 filas SALIDAS ≠ DESPACHO + ROTURA. Son tres números
-- independientes. Si mañana se decide que la rotura descuenta, es una consulta
-- y no una migración: los cuatro están crudos.

create table if not exists produccion_envases_movimientos (
  id               uuid primary key default gen_random_uuid(),
  articulo_id      uuid not null references produccion_envases_articulos(id) on delete restrict,
  -- El código se repite acá a propósito: la planilla lo trae en cada fila y es
  -- lo que permite leer el kardex sin resolver el artículo.
  codigo           text,

  -- date y no timestamptz: es un día, no un instante. Es la corrección que
  -- Inventario ya tuvo que hacer (20260903081542).
  fecha            date,

  entrada          numeric not null default 0,
  salida           numeric not null default 0,
  rotura           numeric not null default 0,
  despacho         numeric not null default 0,

  observacion      text,
  proveedor_raw    text,
  proveedor_id     uuid references proveedores(id) on delete set null,

  creado_por       uuid references usuarios(id) on delete set null,
  -- De dónde vino. Sin esto la sincronización no sabe qué le toca reescribir.
  origen           text not null default 'planilla' check (origen in ('app', 'planilla')),
  sheets_fila      integer,
  -- Por qué no se pudo escribir en la planilla, con lo que dijo Google sin
  -- traducir. Null = está escrito.
  sheets_pendiente    text,
  sheets_pendiente_en timestamptz,
  created_at       timestamptz not null default now(),

  -- Ninguna de las 1.398 filas de la planilla tiene los cuatro en cero: esto
  -- no rechaza nada de lo que hay, y frena la fila empezada y no terminada.
  constraint produccion_envases_mov_algo_paso
    check (entrada + salida + rotura + despacho > 0),
  constraint produccion_envases_mov_no_negativos
    check (entrada >= 0 and salida >= 0 and rotura >= 0 and despacho >= 0)
);

create index if not exists produccion_envases_mov_articulo_idx
  on produccion_envases_movimientos (articulo_id);
create index if not exists produccion_envases_mov_fecha_idx
  on produccion_envases_movimientos (fecha desc);

-- Una fila de la planilla es un movimiento y uno solo: es lo que hace que
-- reimportar no duplique, y el destino del ON CONFLICT de la sincronización.
-- Índice único parcial: como destino de ON CONFLICT hay que nombrar la misma
-- condición (`where sheets_fila is not null`) en el upsert, o Postgres no lo
-- encuentra — trampa #2 del README de migraciones.
create unique index if not exists produccion_envases_mov_sheets_fila_idx
  on produccion_envases_movimientos (sheets_fila) where sheets_fila is not null;

create index if not exists produccion_envases_mov_pendiente_idx
  on produccion_envases_movimientos (sheets_pendiente_en)
  where sheets_pendiente is not null;

comment on column produccion_envases_movimientos.rotura is
  'Se guarda y NO descuenta stock, igual que la planilla. No se deriva de salida: medido, no cierra en 950 de 1.309 filas.';
comment on column produccion_envases_movimientos.origen is
  'app = lo cargó alguien en el SdG. planilla = vino del kardex de Google Sheets.';

-- ── 3. Los proveedores de envases ────────────────────────────
-- Tabla propia y no filas en `proveedores`: la pestaña trae qué envases provee
-- cada uno, que es un dato de este módulo. El enlace al catálogo del núcleo se
-- guarda al lado, y queda en null cuando no se lo reconoce con certeza.

create table if not exists produccion_envases_proveedores (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null unique,
  tipos           text,
  contacto_nombre text,
  contacto_tel    text,
  contacto_alt    text,
  direccion       text,
  notas           text,
  cuit            text,
  proveedor_id    uuid references proveedores(id) on delete set null,
  sheets_fila     integer,
  created_at      timestamptz not null default now()
);

comment on column produccion_envases_proveedores.proveedor_id is
  'El proveedor del núcleo, cuando el CUIT o el nombre lo identifican con certeza. Null si no: enlazar al que se le parece es peor que dejar vacío.';

-- ── 4. La referencia de color, y su historial ────────────────
--
-- La tabla de colores SIN su historial miente. Hoy dice "AMARILLO = RECYCLE
-- BAG" y es verdad; entre el 9 y el 10 de junio de 2026 no lo era, y desde el
-- 3 de julio el verde es de Bolsera y no de Recuperadora del Sur. Guardar sólo
-- la foto de hoy le atribuye un bolsón viejo al proveedor equivocado.

create table if not exists produccion_envases_referencias (
  id               uuid primary key default gen_random_uuid(),
  color            text not null unique,
  proveedor_nombre text,
  orden            integer not null default 0,
  sheets_fila      integer
);

create table if not exists produccion_envases_referencias_historial (
  id          uuid primary key default gen_random_uuid(),
  texto       text not null,
  sheets_fila integer unique
);

-- ── 5. RLS ───────────────────────────────────────────────────
--
-- Las tres funciones de Producción, que ya existen. Leer con acceso al módulo;
-- escribir con edición. El kardex no se edita ni se borra desde la app: un
-- error se corrige con otro movimiento, como en el pañol.

alter table produccion_envases_articulos              enable row level security;
alter table produccion_envases_movimientos            enable row level security;
alter table produccion_envases_proveedores            enable row level security;
alter table produccion_envases_referencias            enable row level security;
alter table produccion_envases_referencias_historial  enable row level security;

drop policy if exists produccion_envases_articulos_select on produccion_envases_articulos;
create policy produccion_envases_articulos_select on produccion_envases_articulos
  for select to authenticated using (tiene_acceso_produccion());

drop policy if exists produccion_envases_articulos_write on produccion_envases_articulos;
create policy produccion_envases_articulos_write on produccion_envases_articulos
  for all to authenticated
  using (es_admin_produccion()) with check (es_admin_produccion());

drop policy if exists produccion_envases_mov_select on produccion_envases_movimientos;
create policy produccion_envases_mov_select on produccion_envases_movimientos
  for select to authenticated using (tiene_acceso_produccion());

drop policy if exists produccion_envases_mov_insert on produccion_envases_movimientos;
create policy produccion_envases_mov_insert on produccion_envases_movimientos
  for insert to authenticated with check (puede_editar_produccion());

-- La ruta del alta actualiza sheets_pendiente sobre la fila que acaba de
-- insertar. Sin este update, un fallo de escritura en la planilla se perdería.
drop policy if exists produccion_envases_mov_update on produccion_envases_movimientos;
create policy produccion_envases_mov_update on produccion_envases_movimientos
  for update to authenticated
  using (puede_editar_produccion()) with check (puede_editar_produccion());

drop policy if exists produccion_envases_prov_select on produccion_envases_proveedores;
create policy produccion_envases_prov_select on produccion_envases_proveedores
  for select to authenticated using (tiene_acceso_produccion());

drop policy if exists produccion_envases_ref_select on produccion_envases_referencias;
create policy produccion_envases_ref_select on produccion_envases_referencias
  for select to authenticated using (tiene_acceso_produccion());

drop policy if exists produccion_envases_ref_hist_select on produccion_envases_referencias_historial;
create policy produccion_envases_ref_hist_select on produccion_envases_referencias_historial
  for select to authenticated using (tiene_acceso_produccion());
```

- [ ] **Paso 3: Commitear y avisar**

```bash
git commit --only supabase/migrations/<timestamp>_produccion_envases.sql -m "feat(produccion): las tablas del stock de envases

Cinco tablas bajo produccion_envases_*, con las tres funciones de permiso que
el módulo ya tiene: sin valor de enum nuevo, así que no hace falta darle un
módulo nuevo a nadie.

El movimiento no es tipo+cantidad como en Inventario sino una fila con cuatro
números: la planilla tiene 4 filas con entrada y salida a la vez y la rotura y
el despacho conviven con la salida en la misma fila. Partirlas rompería el
sheets_fila único.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Decirle al usuario que la aplique** en el editor SQL de Supabase y **quedar a
la espera** para las tareas 5 en adelante. Las tareas 2, 3 y 4 no la necesitan.

---

## Tarea 2: Leer las cuatro pestañas

**Archivos:**
- Crear: `lib/produccion/envases/planilla.ts`
- Crear: `lib/produccion/envases/planilla.test.ts`

Se lee **por encabezado con alias**, como en Inventario: una columna insertada a
mano corre todo lo que está a su derecha y nadie se entera. La excepción es la
**K, que no tiene encabezado** — va por posición, y por eso lleva su propia
comprobación.

- [ ] **Paso 1: Escribir los tests que fallan**

```ts
// lib/produccion/envases/planilla.test.ts
import { describe, it, expect } from "vitest";
import {
  mapearListado, mapearKardex, filaDeArticulo, filaDeMovimiento,
  grupoDeLaFila, filaDeProveedor,
} from "./planilla";

const ENCABEZADO_LISTADO = [
  "Codigo", "Descripción", "STOCK INICAL", "UBICACIÓN",
  "PROVEEDORES (referencia)", "STOCK ACTUAL", "STOCK DE SEGURIDAD", "FALTANTE",
];

// "STOCK INICAL" está mal escrito en la planilla real. El alias tiene que
// tomarlo igual: corregirlo allá rompería fórmulas.
const ENCABEZADO_KARDEX = [
  "CODIGO", "DESCRIPCION", "ENTRADAS", "SALIDAS", "ROTURA", "DESPACHO",
  "STOCK", "FECHA", "OBSERVACIÓN", "PROVEEDOR",
];

describe("el listado", () => {
  it("toma STOCK INICAL, que está mal escrito en la planilla", () => {
    const idx = mapearListado(ENCABEZADO_LISTADO);
    expect(idx.stockInicial).toBe(2);
    expect(idx.stockActual).toBe(5);
    expect(idx.stockSeguridad).toBe(6);
  });

  it("lee un artículo", () => {
    const idx = mapearListado(ENCABEZADO_LISTADO);
    const a = filaDeArticulo(
      ["00001", "BOLSAS CAL GÜEMES", "13600", "", "", "8091", "30000", "21909"],
      idx, 2
    );
    expect(a).toEqual({
      codigo: "00001",
      descripcion: "BOLSAS CAL GÜEMES",
      ubicacion: null,
      proveedores_ref: null,
      stock_inicial: 13600,
      stock_actual: 8091,
      stock_seguridad: 30000,
      sheets_fila: 2,
    });
  });

  it("descarta la fila sin código o sin descripción", () => {
    const idx = mapearListado(ENCABEZADO_LISTADO);
    expect(filaDeArticulo(["", "", "", "", "", "0"], idx, 40)).toBeNull();
    expect(filaDeArticulo(["00099", "", "", "", "", "0"], idx, 41)).toBeNull();
  });
});

describe("el kardex", () => {
  const idx = mapearKardex(ENCABEZADO_KARDEX);

  it("lee los cuatro números de una fila, y la fecha en d/m", () => {
    const m = filaDeMovimiento(
      ["00001", "BOLSAS CAL GÜEMES", "", "1200", "8", "1200", "12.400", "1/9/2025", "", ""],
      idx, 2
    );
    expect(m).toMatchObject({
      codigo: "00001",
      entrada: 0, salida: 1200, rotura: 8, despacho: 1200,
      // 1 de septiembre, no 9 de enero. Leerlo al revés dio vuelta 885 fechas
      // en Compras.
      fecha: "2025-09-01",
      sheets_fila: 2,
    });
  });

  it("acepta entrada y salida en la misma fila: hay 4 así en la planilla", () => {
    const m = filaDeMovimiento(
      ["00001", "x", "25600", "1500", "", "", "36.500", "2/9/2025"], idx, 10
    );
    expect(m).toMatchObject({ entrada: 25600, salida: 1500 });
  });

  it("acepta despacho con salida en cero: hay 133 así", () => {
    const m = filaDeMovimiento(
      ["00006", "x", "", "0", "", "192", "11.214", "12/9/2026"], idx, 1398
    );
    expect(m).toMatchObject({ salida: 0, despacho: 192 });
  });

  it("descarta la fila sin código y la que no movió nada", () => {
    expect(filaDeMovimiento(["", "x", "", "", "", ""], idx, 1500)).toBeNull();
    expect(filaDeMovimiento(["00001", "x", "", "0", "0", "0"], idx, 1501)).toBeNull();
  });
});

describe("el grupo de envase, que vive en la K sin encabezado", () => {
  it("lo lee de la posición 10", () => {
    const fila = ["00009", "BOLSONES BRALBOL (2,10 CAL)", "", "93", "", "64",
                  "807", "1/9/2025", "", "", "BOLSONES 2,10 + 1,90"];
    expect(grupoDeLaFila(fila)).toBe("BOLSONES 2,10 + 1,90");
  });

  it("no toma un número ni una fecha: eso es una columna corrida", () => {
    // Si alguien inserta una columna, en la posición 10 aparece cualquier cosa.
    // Preferimos null —que se informa— antes que un grupo inventado.
    expect(grupoDeLaFila(["00009", "x", "", "", "", "", "", "", "", "", "807"])).toBeNull();
    expect(grupoDeLaFila(["00009", "x", "", "", "", "", "", "", "", "", "1/9/2025"])).toBeNull();
    expect(grupoDeLaFila(["00009", "x"])).toBeNull();
  });
});

describe("los proveedores", () => {
  it("lee uno, con su CUIT", () => {
    const encabezado = ["Proveedor", "Tipo de proveedor", "Nombre", "Contactos",
                        "Contacto Alternativo", "Dirección", "Notas", "CUIT"];
    const p = filaDeProveedor(
      ["Bralbol", "Bolsones 1.20, Bolsones 2.10", "Belén", "542477270940",
       "administracion@bralbol.com.ar", "Bralbol", "", "30-71515352-8"],
      encabezado, 8
    );
    expect(p).toMatchObject({
      nombre: "Bralbol",
      tipos: "Bolsones 1.20, Bolsones 2.10",
      contacto_nombre: "Belén",
      cuit: "30715153528",
      sheets_fila: 8,
    });
  });

  it("descarta la fila sin nombre", () => {
    expect(filaDeProveedor(["", "", ""], ["Proveedor"], 20)).toBeNull();
  });
});
```

- [ ] **Paso 2: Correr los tests y ver que fallan**

```bash
npx vitest run lib/produccion/envases/planilla.test.ts
```

Esperado: FAIL, "Failed to resolve import ./planilla".

- [ ] **Paso 3: Escribir el parser**

```ts
// lib/produccion/envases/planilla.ts
/**
 * Leer la planilla de stock de envases que lleva calidad.
 *
 * Es la planilla del almacén clonada —mismos nombres de pestaña, mismo stock
 * por fórmula sobre el kardex— con otras columnas: acá la A es el código y no
 * el N° de RI, y el kardex trae ROTURA y DESPACHO, que allá no existen.
 *
 * Se lee **por encabezado con alias y no por posición**, por lo mismo que en
 * Inventario: una columna insertada a mano corre todo lo que está a su derecha
 * y nadie se entera. La única excepción es la columna K, que no tiene
 * encabezado — ver `grupoDeLaFila`.
 */

// Los helpers genéricos de Sheets viven en Mantenimiento por haber llegado
// primero. Se importan y no se copian: `fechaDeSheets` concentra la corrección
// del día y el mes dados vuelta, y tenerla dos veces es cómo se arregla en una
// sola.
import { texto, normalizar, fechaDeSheets } from "@/lib/mantenimiento/planilla";
import { normalizarCuit } from "@/lib/core/cuit";

/** Un texto de la planilla, donde un guión suelto es "acá no va nada". */
const campo = (v: unknown): string | null => {
  const s = texto(v);
  return s === null || s === "-" ? null : s;
};

/** Un encabezado listo para comparar: sin acentos, mayúsculas ni puntuación. */
const clave = (v: unknown): string =>
  normalizar(v).toUpperCase().replace(/[.°º]/g, "").replace(/\s+/g, " ").trim();

export type Indice = Record<string, number>;

function mapear(encabezado: unknown[], alias: Record<string, string[]>): Indice {
  const claves = encabezado.map(clave);
  const idx: Indice = {};
  for (const [nombre, posibles] of Object.entries(alias)) {
    idx[nombre] = -1;
    for (const a of posibles) {
      const i = claves.indexOf(clave(a));
      if (i >= 0) { idx[nombre] = i; break; }
    }
  }
  return idx;
}

/**
 * `STOCK INICAL` está así, mal escrito, en la planilla real. Va como alias en
 * vez de corregirse allá: la celda es referencia de fórmulas y renombrarla las
 * rompe.
 */
const ALIAS_LISTADO: Record<string, string[]> = {
  codigo: ["CODIGO", "COD"],
  descripcion: ["DESCRIPCION", "DETALLE", "PRODUCTO"],
  stockInicial: ["STOCK INICAL", "STOCK INICIAL", "INICIAL"],
  ubicacion: ["UBICACION", "DEPOSITO", "LUGAR"],
  proveedoresRef: ["PROVEEDORES (REFERENCIA)", "PROVEEDORES", "PROVEEDOR"],
  stockActual: ["STOCK ACTUAL", "STOCK", "EXISTENCIA", "SALDO"],
  stockSeguridad: ["STOCK DE SEGURIDAD", "STOCK SEGURIDAD", "STOCK MINIMO", "MINIMO"],
};

const ALIAS_KARDEX: Record<string, string[]> = {
  codigo: ["CODIGO", "COD"],
  descripcion: ["DESCRIPCION", "DETALLE", "PRODUCTO"],
  entrada: ["ENTRADAS", "ENTRADA", "INGRESO", "INGRESOS"],
  salida: ["SALIDAS", "SALIDA", "EGRESO", "EGRESOS"],
  rotura: ["ROTURA", "ROTURAS", "ROTO"],
  despacho: ["DESPACHO", "DESPACHOS", "DESPACHADO"],
  stock: ["STOCK", "SALDO"],
  fecha: ["FECHA", "DIA"],
  observacion: ["OBSERVACION", "OBSERVACIONES", "NOTA", "NOTAS"],
  proveedor: ["PROVEEDOR", "PROVEEDORES"],
};

const ALIAS_PROVEEDOR: Record<string, string[]> = {
  nombre: ["PROVEEDOR", "NOMBRE DEL PROVEEDOR"],
  tipos: ["TIPO DE PROVEEDOR", "TIPO", "TIPOS"],
  contactoNombre: ["NOMBRE", "CONTACTO"],
  contactoTel: ["CONTACTOS", "TELEFONO", "TEL"],
  contactoAlt: ["CONTACTO ALTERNATIVO", "ALTERNATIVO", "MAIL", "EMAIL"],
  direccion: ["DIRECCION", "DOMICILIO"],
  notas: ["NOTAS", "OBSERVACIONES"],
  cuit: ["CUIT", "CUIL"],
};

export const mapearListado = (e: unknown[]): Indice => mapear(e, ALIAS_LISTADO);
export const mapearKardex = (e: unknown[]): Indice => mapear(e, ALIAS_KARDEX);

/**
 * Una cantidad de la planilla. Vacío es **null**, no cero: "nadie lo contó" y
 * "no hay" son cosas distintas. Un cero escrito sí es cero.
 */
export function cantidad(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;
  const s = String(valor).trim();
  if (s === "" || s === "-") return null;
  // Formato argentino: "12.400" son doce mil cuatrocientos.
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export interface ArticuloLeido {
  codigo: string;
  descripcion: string;
  ubicacion: string | null;
  proveedores_ref: string | null;
  stock_inicial: number;
  stock_actual: number;
  stock_seguridad: number;
  sheets_fila: number;
}

/** Una fila del listado. `null` si no identifica a ningún artículo. */
export function filaDeArticulo(
  fila: unknown[], idx: Indice, numeroFila: number
): ArticuloLeido | null {
  const celda = (n: string): unknown => (idx[n] >= 0 ? fila[idx[n]] : undefined);

  const codigo = campo(celda("codigo"));
  const descripcion = campo(celda("descripcion"));
  if (!codigo || !descripcion) return null;

  return {
    codigo,
    descripcion,
    ubicacion: campo(celda("ubicacion")),
    proveedores_ref: campo(celda("proveedoresRef")),
    stock_inicial: cantidad(celda("stockInicial")) ?? 0,
    stock_actual: cantidad(celda("stockActual")) ?? 0,
    stock_seguridad: cantidad(celda("stockSeguridad")) ?? 0,
    sheets_fila: numeroFila,
  };
}

/**
 * La columna K: el grupo de envase.
 *
 * **Es la única que se lee por posición**, porque no tiene encabezado: es una
 * `ARRAYFORMULA` puesta en `K2` que clasifica el código. Como la posición es
 * frágil —una columna insertada la corre—, lo que salga tiene que **parecer un
 * grupo**: texto, no un número ni una fecha. Si no lo parece, `null`, que la
 * sincronización informa. Un grupo inventado manda el artículo al total que no
 * es y no se nota nunca.
 */
export const COL_GRUPO = 10;

export function grupoDeLaFila(fila: unknown[]): string | null {
  const v = campo(fila[COL_GRUPO]);
  if (!v) return null;
  // Un número o una fecha en esa posición es una columna corrida, no un grupo.
  if (cantidad(v) !== null) return null;
  if (fechaDeSheets(v) !== null) return null;
  return v;
}

export interface MovimientoLeido {
  codigo: string;
  descripcion: string | null;
  entrada: number;
  salida: number;
  rotura: number;
  despacho: number;
  stock_resultante: number | null;
  fecha: string | null;
  observacion: string | null;
  proveedor_raw: string | null;
  grupo_raw: string | null;
  sheets_fila: number;
}

/**
 * Una fila del kardex. `null` si no es un movimiento.
 *
 * A diferencia de Inventario, **entrada y salida juntas no se descartan**: la
 * planilla tiene 4 filas así y son buenas. Y la rotura y el despacho conviven
 * con la salida. Lo único que se descarta es la fila sin código —la A es la
 * que dice si la fila tiene datos— y la que no movió ninguno de los cuatro
 * números, que es una fila empezada y no terminada.
 */
export function filaDeMovimiento(
  fila: unknown[], idx: Indice, numeroFila: number
): MovimientoLeido | null {
  const celda = (n: string): unknown => (idx[n] >= 0 ? fila[idx[n]] : undefined);

  const codigo = campo(celda("codigo"));
  if (!codigo) return null;

  const entrada = cantidad(celda("entrada")) ?? 0;
  const salida = cantidad(celda("salida")) ?? 0;
  const rotura = cantidad(celda("rotura")) ?? 0;
  const despacho = cantidad(celda("despacho")) ?? 0;
  if (entrada + salida + rotura + despacho <= 0) return null;

  return {
    codigo,
    descripcion: campo(celda("descripcion")),
    entrada, salida, rotura, despacho,
    stock_resultante: cantidad(celda("stock")),
    fecha: fechaDeSheets(celda("fecha")),
    observacion: campo(celda("observacion")),
    proveedor_raw: campo(celda("proveedor")),
    grupo_raw: grupoDeLaFila(fila),
    sheets_fila: numeroFila,
  };
}

export interface ProveedorLeido {
  nombre: string;
  tipos: string | null;
  contacto_nombre: string | null;
  contacto_tel: string | null;
  contacto_alt: string | null;
  direccion: string | null;
  notas: string | null;
  cuit: string | null;
  sheets_fila: number;
}

/** Una fila de `PROVEEDORES`. `null` si no tiene nombre. */
export function filaDeProveedor(
  fila: unknown[], encabezado: unknown[], numeroFila: number
): ProveedorLeido | null {
  const idx = mapear(encabezado, ALIAS_PROVEEDOR);
  const celda = (n: string): unknown => (idx[n] >= 0 ? fila[idx[n]] : undefined);

  const nombre = campo(celda("nombre"));
  if (!nombre) return null;

  return {
    nombre,
    tipos: campo(celda("tipos")),
    contacto_nombre: campo(celda("contactoNombre")),
    contacto_tel: campo(celda("contactoTel")),
    contacto_alt: campo(celda("contactoAlt")),
    direccion: campo(celda("direccion")),
    notas: campo(celda("notas")),
    cuit: normalizarCuit(campo(celda("cuit"))),
    sheets_fila: numeroFila,
  };
}
```

- [ ] **Paso 4: Correr los tests y ver que pasan**

```bash
npx vitest run lib/produccion/envases/planilla.test.ts
```

Esperado: PASS, 11 tests.

Si `filaDeProveedor` falla por el contacto: `ALIAS_PROVEEDOR.contactoNombre`
busca `NOMBRE` y `ALIAS_PROVEEDOR.nombre` busca `PROVEEDOR`; son columnas
distintas en la planilla y el alias de cada uno tiene que encontrar la suya.

- [ ] **Paso 5: Commitear**

```bash
git commit --only lib/produccion/envases/planilla.ts lib/produccion/envases/planilla.test.ts -m "feat(produccion): leer la planilla de envases

Por encabezado con alias, salvo la K —el grupo de envase— que no tiene
encabezado y va por posición. Como la posición es frágil, lo que salga tiene
que parecer un grupo: si es un número o una fecha, es una columna corrida y
queda en null para que la sincronización lo informe.

El movimiento lleva los cuatro números de la fila. Entrada y salida juntas no
se descartan como en Inventario: la planilla tiene 4 filas así y son buenas.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Tarea 3: El cálculo del resumen por período

**Archivos:**
- Crear: `lib/produccion/envases/informe.ts`
- Crear: `lib/produccion/envases/informe.test.ts`

Reemplaza la pestaña `Entradas  Salidas x Envase`. **No replica su error**: esa
pestaña agrupa los ingresos y egresos con comodines sobre la descripción
(`"*1,20*"`, `"*NUEVOS*"`) y los bolsones nuevos caen en dos grupos.

- [ ] **Paso 1: Escribir los tests que fallan**

```ts
// lib/produccion/envases/informe.test.ts
import { describe, it, expect } from "vitest";
import { resumirPorGrupo } from "./informe";

const ARTICULOS = [
  { id: "a", codigo: "00014", grupo: "BOLSONES 1,20 + 1,40", stock_actual: 746 },
  { id: "b", codigo: "00024", grupo: "BOLSONES 1,20 NUEVOS", stock_actual: 0 },
  { id: "c", codigo: "00025", grupo: "BOLSONES 1,20 NUEVOS", stock_actual: 600 },
  // Sin movimientos nunca, así que la K no le dio grupo.
  { id: "d", codigo: "00011", grupo: null, stock_actual: 15 },
];

const MOVS = [
  { articulo_id: "a", fecha: "2026-09-01", entrada: 0, salida: 100, rotura: 2, despacho: 90 },
  { articulo_id: "b", fecha: "2026-09-02", entrada: 0, salida: 40, rotura: 0, despacho: 0 },
  { articulo_id: "a", fecha: "2026-08-01", entrada: 500, salida: 0, rotura: 0, despacho: 0 },
];

describe("resumirPorGrupo", () => {
  it("no cuenta los bolsones nuevos en dos grupos, como sí hace la planilla", () => {
    const r = resumirPorGrupo(ARTICULOS, MOVS, { desde: "2026-09-01", hasta: "2026-09-30" });

    const mixto = r.find((g) => g.grupo === "BOLSONES 1,20 + 1,40")!;
    const nuevos = r.find((g) => g.grupo === "BOLSONES 1,20 NUEVOS")!;

    // Los 40 del 00024 están en "NUEVOS" y NO en "1,20 + 1,40". La planilla los
    // pone en los dos, porque "BOLSONES NUEVOS TORRACO (1,20 P 02)" matchea
    // tanto "*1,20*" como "*NUEVOS*".
    expect(mixto.egresos).toBe(100);
    expect(nuevos.egresos).toBe(40);
  });

  it("deja afuera lo que no cae en el rango", () => {
    const r = resumirPorGrupo(ARTICULOS, MOVS, { desde: "2026-09-01", hasta: "2026-09-30" });
    // La entrada de 500 es del 1/8: fuera del rango.
    expect(r.find((g) => g.grupo === "BOLSONES 1,20 + 1,40")!.ingresos).toBe(0);
  });

  it("incluye los dos extremos del rango", () => {
    const r = resumirPorGrupo(ARTICULOS, MOVS, { desde: "2026-09-02", hasta: "2026-09-02" });
    expect(r.find((g) => g.grupo === "BOLSONES 1,20 NUEVOS")!.egresos).toBe(40);
  });

  it("lleva rotura y despacho, que la planilla no resume", () => {
    const r = resumirPorGrupo(ARTICULOS, MOVS, { desde: "2026-09-01", hasta: "2026-09-30" });
    const mixto = r.find((g) => g.grupo === "BOLSONES 1,20 + 1,40")!;
    expect(mixto.rotura).toBe(2);
    expect(mixto.despacho).toBe(90);
  });

  it("el stock es el de todos los artículos del grupo, tengan o no movimientos", () => {
    const r = resumirPorGrupo(ARTICULOS, MOVS, { desde: "2026-09-01", hasta: "2026-09-30" });
    // 00024 (0) + 00025 (600). La planilla deja afuera a los que nunca se
    // movieron; acá 00025 entra igual.
    expect(r.find((g) => g.grupo === "BOLSONES 1,20 NUEVOS")!.stock).toBe(600);
  });

  it("los artículos sin grupo no desaparecen: van al final, en 'Sin grupo'", () => {
    const r = resumirPorGrupo(ARTICULOS, MOVS, { desde: "2026-09-01", hasta: "2026-09-30" });
    const ultimo = r[r.length - 1];
    expect(ultimo.grupo).toBeNull();
    expect(ultimo.stock).toBe(15);
  });

  it("ordena los grupos por nombre, para que la tabla no baile entre corridas", () => {
    const r = resumirPorGrupo(ARTICULOS, MOVS, { desde: "2026-09-01", hasta: "2026-09-30" });
    expect(r.map((g) => g.grupo)).toEqual([
      "BOLSONES 1,20 + 1,40", "BOLSONES 1,20 NUEVOS", null,
    ]);
  });
});
```

- [ ] **Paso 2: Correr los tests y ver que fallan**

```bash
npx vitest run lib/produccion/envases/informe.test.ts
```

Esperado: FAIL, "Failed to resolve import ./informe".

- [ ] **Paso 3: Escribir el informe**

```ts
// lib/produccion/envases/informe.ts
/**
 * El resumen por período y grupo de envase.
 *
 * Reemplaza la pestaña `Entradas  Salidas x Envase`, y **a propósito no da lo
 * mismo que ella**. Esa pestaña tiene dos problemas medidos:
 *
 * 1. Agrupa los ingresos y egresos con comodines sobre la **descripción**
 *    (`"*1,20*"`, `"*NUEVOS*"`), y `BOLSONES NUEVOS TORRACO (1,20 P 02)`
 *    matchea los dos: lo cuenta dos veces. Acá se agrupa por el `grupo` del
 *    artículo, que sale de la columna K — la misma que esa pestaña usa para su
 *    columna de stock, y que agrupa bien.
 * 2. Su `STOCK FINAL` sólo suma los artículos que tienen **al menos un
 *    movimiento**. Acá suma todos los del grupo.
 *
 * Que dé distinto no es un bug: está explicado en la pantalla.
 */

export interface ArticuloDelInforme {
  id: string;
  codigo: string;
  grupo: string | null;
  stock_actual: number;
}

export interface MovimientoDelInforme {
  articulo_id: string;
  /** ISO corto, `aaaa-mm-dd`. Puede faltar: la planilla tiene filas sin fecha. */
  fecha: string | null;
  entrada: number;
  salida: number;
  rotura: number;
  despacho: number;
}

export interface Rango {
  /** ISO corto. Los dos extremos entran. */
  desde: string;
  hasta: string;
}

export interface FilaDelInforme {
  /** `null` es el renglón "Sin grupo", que va último. */
  grupo: string | null;
  ingresos: number;
  egresos: number;
  rotura: number;
  despacho: number;
  /**
   * El stock de hoy, no el del período. Es la misma aclaración que la planilla
   * lleva al pie: el saldo no es la diferencia entre los ingresos y los egresos
   * del rango.
   */
  stock: number;
  articulos: number;
}

export function resumirPorGrupo(
  articulos: ArticuloDelInforme[],
  movimientos: MovimientoDelInforme[],
  rango: Rango
): FilaDelInforme[] {
  const grupoDe = new Map(articulos.map((a) => [a.id, a.grupo]));
  const filas = new Map<string | null, FilaDelInforme>();

  const filaDe = (grupo: string | null): FilaDelInforme => {
    let f = filas.get(grupo);
    if (!f) {
      f = { grupo, ingresos: 0, egresos: 0, rotura: 0, despacho: 0, stock: 0, articulos: 0 };
      filas.set(grupo, f);
    }
    return f;
  };

  // El stock y el conteo salen de los artículos y no de los movimientos: un
  // artículo que nunca se movió igual tiene stock, y dejarlo afuera es el
  // agujero de la planilla.
  for (const a of articulos) {
    const f = filaDe(a.grupo);
    f.stock += a.stock_actual;
    f.articulos += 1;
  }

  for (const m of movimientos) {
    // Sin fecha no se puede ubicar en el período. No se cuenta ni se supone.
    if (!m.fecha) continue;
    const dia = m.fecha.slice(0, 10);
    if (dia < rango.desde || dia > rango.hasta) continue;

    const f = filaDe(grupoDe.get(m.articulo_id) ?? null);
    f.ingresos += m.entrada;
    f.egresos += m.salida;
    f.rotura += m.rotura;
    f.despacho += m.despacho;
  }

  // Por nombre, y "Sin grupo" último: sin un orden fijo la tabla cambia de
  // forma entre dos corridas iguales y no se puede comparar.
  return [...filas.values()].sort((a, b) => {
    if (a.grupo === null) return 1;
    if (b.grupo === null) return -1;
    return a.grupo.localeCompare(b.grupo, "es");
  });
}
```

- [ ] **Paso 4: Correr los tests y ver que pasan**

```bash
npx vitest run lib/produccion/envases/informe.test.ts
```

Esperado: PASS, 7 tests.

- [ ] **Paso 5: Commitear**

```bash
git commit --only lib/produccion/envases/informe.ts lib/produccion/envases/informe.test.ts -m "feat(produccion): el resumen de envases por periodo y grupo

Agrupa por el grupo del articulo —la columna K— y no por comodines sobre la
descripcion, asi que no cuenta los bolsones nuevos dos veces como hace la
planilla. El stock suma todos los articulos del grupo, tengan o no
movimientos: dejar afuera a los que nunca se movieron es el otro agujero de
esa pestaña.

Los articulos sin grupo van a un renglon 'Sin grupo' en vez de desaparecer: un
total que no cierra se ve, uno al que le falta un renglon no.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Tarea 4: El espejo — qué celdas se escriben

**Archivos:**
- Crear: `lib/produccion/envases/espejo.ts`
- Crear: `lib/produccion/envases/espejo.test.ts`

La parte que decide **qué se toca y qué no** va separada de la llamada a Google,
para poder probarla: escribir la G de más rompe el stock de todo lo que viene
abajo.

- [ ] **Paso 1: Escribir los tests que fallan**

```ts
// lib/produccion/envases/espejo.test.ts
import { describe, it, expect } from "vitest";
import { celdasDelMovimiento, fechaParaLaPlanilla, COL } from "./espejo";

const MOV = {
  codigo: "00001",
  entrada: 0,
  salida: 1200,
  rotura: 8,
  despacho: 1200,
  fecha: "2026-09-15",
  observacion: "Rto. Flexi Rigs: 00001 - 3290",
  proveedor: null,
};

describe("celdasDelMovimiento", () => {
  it("nunca escribe la B, la G ni la K: son fórmulas", () => {
    const celdas = celdasDelMovimiento(MOV, 1404, "Entradas  Salidas");
    const columnas = celdas.map((c) => c.columna);

    // B = VLOOKUP de la descripción, G = el saldo corriente,
    // K = la ARRAYFORMULA del grupo. Escribir cualquiera la rompe, y con la G
    // se rompe el stock de todo lo que viene abajo.
    expect(columnas).not.toContain(1);
    expect(columnas).not.toContain(6);
    expect(columnas).not.toContain(10);
  });

  it("escribe las ocho que sí van", () => {
    const celdas = celdasDelMovimiento(MOV, 1404, "Entradas  Salidas");
    expect(celdas.map((c) => c.columna).sort((a, b) => a - b))
      .toEqual([0, 2, 3, 4, 5, 7, 8, 9]);
    expect(celdas.every((c) => c.fila === 1404)).toBe(true);
    expect(celdas.every((c) => c.pestana === "Entradas  Salidas")).toBe(true);
  });

  it("pone los números, y el cero va vacío", () => {
    const celdas = celdasDelMovimiento(MOV, 1404, "Entradas  Salidas");
    const valor = (col: number) => celdas.find((c) => c.columna === col)!.valor;

    expect(valor(COL.codigo)).toBe("00001");
    // Entrada en cero: la celda va vacía, como las escribe la gente. Un "0"
    // escrito se lee como "se contó y dio cero", que es otra cosa.
    expect(valor(COL.entrada)).toBe("");
    expect(valor(COL.salida)).toBe("1200");
    expect(valor(COL.rotura)).toBe("8");
    expect(valor(COL.despacho)).toBe("1200");
    expect(valor(COL.observacion)).toBe("Rto. Flexi Rigs: 00001 - 3290");
    expect(valor(COL.proveedor)).toBe("");
  });
});

describe("fechaParaLaPlanilla", () => {
  it("escribe d/m/aaaa, nunca m/d", () => {
    expect(fechaParaLaPlanilla("2026-09-15")).toBe("15/9/2026");
    // El caso que importa: el 1 de septiembre no es el 9 de enero.
    expect(fechaParaLaPlanilla("2025-09-01")).toBe("1/9/2025");
  });

  it("sin fecha, celda vacía", () => {
    expect(fechaParaLaPlanilla(null)).toBe("");
  });
});
```

- [ ] **Paso 2: Correr los tests y ver que fallan**

```bash
npx vitest run lib/produccion/envases/espejo.test.ts
```

Esperado: FAIL, "Failed to resolve import ./espejo".

- [ ] **Paso 3: Escribir el espejo**

```ts
// lib/produccion/envases/espejo.ts
/**
 * Escribir en la planilla de envases el movimiento que se cargó en el SdG.
 *
 * La planilla manda, así que un movimiento que no llega allá **no existe**: la
 * próxima sincronización lee el stock de la fórmula —que no lo incluye— y
 * revierte el número. Por eso esto no es decorativo, no corre en segundo plano,
 * y cuando falla queda anotado en vez de perderse en un log.
 */

import { leerValores, escribirCeldas, filaSiguienteSegunLaColumna } from "@/lib/core/sheets";

/**
 * Las columnas del kardex `Entradas  Salidas`, en base 0.
 *
 * **Faltan tres, y las tres faltan a propósito:**
 *
 * - **B (1)** es la descripción, un `VLOOKUP` contra el listado.
 * - **G (6)** es el saldo corriente. Escribirla rompe el stock de todo lo que
 *   viene abajo.
 * - **K (10)** es el grupo de envase, una `ARRAYFORMULA` puesta en `K2` que
 *   cubre la columna entera.
 *
 * Están arrastradas hasta la fila 3296 —verificado—, así que una fila nueva se
 * completa sola y hay ~1.890 libres antes de tener que estirar nada.
 */
export const COL = {
  codigo: 0,      // A  ← la que dice si la fila tiene datos
  // B = descripción, fórmula. No se toca.
  entrada: 2,     // C
  salida: 3,      // D
  rotura: 4,      // E
  despacho: 5,    // F
  // G = saldo, fórmula. No se toca.
  fecha: 7,       // H
  observacion: 8, // I
  proveedor: 9,   // J
  // K = grupo, ARRAYFORMULA. No se toca.
} as const;

export interface MovimientoAEspejar {
  codigo: string;
  entrada: number;
  salida: number;
  rotura: number;
  despacho: number;
  /** ISO. Se escribe como d/m/aaaa, que es como la lee la planilla. */
  fecha: string | null;
  observacion: string | null;
  proveedor: string | null;
}

export interface Celda {
  pestana: string;
  columna: number;
  fila: number;
  valor: string;
}

/** Una fecha ISO como la escribe la planilla: d/m/aaaa, nunca m/d. */
export function fechaParaLaPlanilla(iso: string | null | undefined): string {
  if (!iso) return "";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return a && m && d ? `${Number(d)}/${Number(m)}/${a}` : "";
}

/**
 * Un número para la planilla, donde el cero va vacío.
 *
 * Es cómo las escribe la gente, y además preserva la distinción: una celda
 * vacía es "acá no pasó nada" y un cero escrito es "se contó y dio cero". La
 * fórmula del saldo suma igual las dos, pero quien mira la planilla no.
 */
const numero = (n: number): string => (n > 0 ? String(n) : "");

/**
 * Qué celdas hay que escribir para dejar el movimiento en la planilla.
 *
 * Va aparte de la llamada a Google para poder probarla: es la parte que decide
 * qué se toca y qué no, y tocar la G de más sería romper la planilla entera.
 */
export function celdasDelMovimiento(
  m: MovimientoAEspejar, fila: number, pestana: string
): Celda[] {
  const celda = (columna: number, valor: string): Celda => ({ pestana, columna, fila, valor });

  return [
    celda(COL.codigo, m.codigo),
    celda(COL.entrada, numero(m.entrada)),
    celda(COL.salida, numero(m.salida)),
    celda(COL.rotura, numero(m.rotura)),
    celda(COL.despacho, numero(m.despacho)),
    celda(COL.fecha, fechaParaLaPlanilla(m.fecha)),
    celda(COL.observacion, m.observacion ?? ""),
    celda(COL.proveedor, m.proveedor ?? ""),
  ];
}

const PLANILLA = () => process.env.GOOGLE_SHEETS_ENVASES_ID ?? "";
const TAB_KARDEX = () => process.env.GOOGLE_SHEETS_ENVASES_TAB_MOV ?? "Entradas  Salidas";

export interface ResultadoEspejo {
  ok: boolean;
  /** En qué fila quedó, para reconocerlo al releer. */
  fila?: number;
  /** Qué dijo Google, sin traducir. */
  error?: string;
}

/**
 * Escribe el movimiento al final del kardex.
 *
 * La fila se busca por la **columna A**, que acá es el código y está en todas
 * las filas con datos. (En el almacén se busca por la B, porque allá la A es el
 * N° de requerimiento y viene vacía casi siempre: son dos planillas parecidas
 * con la primera columna distinta.)
 *
 * Se **busca** y no se cuenta: hay huecos —la última fila con código es la 1403
 * y sólo 1.398 tienen datos—, así que contar dejaría la fila nueva encima de
 * una que ya existe.
 *
 * No lanza: devuelve qué pasó. Quien lo llama decide, y lo que decide es anotar
 * el pendiente — no tragárselo.
 */
export async function espejarMovimiento(m: MovimientoAEspejar): Promise<ResultadoEspejo> {
  const planilla = PLANILLA();
  if (!planilla) {
    return { ok: false, error: "Falta configurar GOOGLE_SHEETS_ENVASES_ID" };
  }

  const pestana = TAB_KARDEX();

  try {
    const columnaA = await leerValores(planilla, `${pestana}!A:A`, { sinFormato: true });
    const fila = filaSiguienteSegunLaColumna(columnaA);

    await escribirCeldas(planilla, celdasDelMovimiento(m, fila, pestana));
    return { ok: true, fila };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

- [ ] **Paso 4: Correr los tests y ver que pasan**

```bash
npx vitest run lib/produccion/envases/espejo.test.ts
```

Esperado: PASS, 5 tests.

- [ ] **Paso 5: Commitear**

```bash
git commit --only lib/produccion/envases/espejo.ts lib/produccion/envases/espejo.test.ts -m "feat(produccion): escribir el movimiento de envases en la planilla

Ocho columnas, y las tres que faltan faltan a proposito: B es el VLOOKUP de la
descripcion, G es el saldo corriente y K la ARRAYFORMULA del grupo. Hay un test
que falla si alguna vuelve a aparecer.

La fila libre se busca por la columna A —que aca es el codigo, no el N° de RI
como en el almacen— y se busca en vez de contarse: hay huecos, la ultima fila
con codigo es la 1403 y solo 1.398 tienen datos.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Tarea 5: Traer de la planilla

**Requiere la tarea 1 aplicada.** Si la migración todavía no corrió, parar acá.

**Archivos:**
- Crear: `lib/produccion/envases/sincronizar.ts`
- Crear: `app/api/produccion/envases/sync/route.ts`

Esta misma función **es la carga inicial**: la primera corrida trae los 26
artículos, los 1.398 movimientos, los 16 proveedores y las referencias. No hay
importador aparte — un script `.mjs` no podría usar el parser de la tarea 2 y
habría que duplicarlo sin tests, que es cómo las dos copias se separan.

- [ ] **Paso 1: Escribir la sincronización**

```ts
// lib/produccion/envases/sincronizar.ts
/**
 * Traer de la planilla lo que la sección Envases espeja.
 *
 * LA PLANILLA MANDA, al revés que el resto de Producción. El stock del listado
 * es una fórmula sobre el kardex, así que es el stock consolidado correcto: acá
 * se lee y se anota cuándo. El SdG no lo calcula.
 *
 * Es también **la carga inicial**: la primera corrida trae todo.
 *
 * Vive en `lib` y no dentro de la ruta porque lo van a llamar dos cosas con
 * permisos distintos: el botón, que exige sesión, y el reloj, que no tiene
 * ninguna.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { registrarSincronizacion } from "@/lib/core/sincronizaciones";
import { leerValores } from "@/lib/core/sheets";
import { traerTodo } from "@/lib/core/paginado";
import { indiceDeProveedores, buscarProveedor } from "@/lib/core/proveedores";
import { normalizarCuit } from "@/lib/core/cuit";
import {
  mapearListado, mapearKardex, filaDeArticulo, filaDeMovimiento, filaDeProveedor,
  type ArticuloLeido, type MovimientoLeido, type ProveedorLeido,
} from "@/lib/produccion/envases/planilla";

type Datos = Record<string, unknown>;

export type Resultado =
  | { ok: true; datos: Datos }
  | { ok: false; status: number; error: string; datos?: Datos };

const logra = (datos: Datos): Resultado => ({ ok: true, datos });
const falla = (status: number, error: string): Resultado => ({ ok: false, status, error });
const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));

const PLANILLA = () => process.env.GOOGLE_SHEETS_ENVASES_ID ?? "";
const TAB_LISTADO = () => process.env.GOOGLE_SHEETS_ENVASES_TAB ?? "Listado articulos GRAL";
/** Lleva **doble espacio**, que es como está en la planilla. */
const TAB_KARDEX = () => process.env.GOOGLE_SHEETS_ENVASES_TAB_MOV ?? "Entradas  Salidas";
const TAB_PROV = () => process.env.GOOGLE_SHEETS_ENVASES_TAB_PROV ?? "PROVEEDORES";
const TAB_REF = () => process.env.GOOGLE_SHEETS_ENVASES_TAB_REF ?? "REFERENCIAS";

/**
 * Traer de la planilla, y que un fallo diga qué pasó.
 *
 * Adentro casi todo devuelve `falla(...)` con un motivo, pero los `traerTodo`
 * **lanzan**, y una excepción que sube hasta la ruta se convierte en un 500 sin
 * cuerpo: la pantalla muestra su texto de reserva, que no distingue una tabla
 * que falta de Google caído de un permiso mal dado.
 */
export async function sincronizarEnvases(): Promise<Resultado> {
  try {
    return await traerDeLaPlanilla();
  } catch (e) {
    const detalle = mensaje(e);
    await registrarSincronizacion({
      modulo: "produccion", recurso: "envases_movimientos", ok: false, error: detalle,
    });
    return falla(500, detalle);
  }
}

async function traerDeLaPlanilla(): Promise<Resultado> {
  const planilla = PLANILLA();
  if (!planilla) return falla(503, "Falta configurar GOOGLE_SHEETS_ENVASES_ID");

  const admin = createAdminClient();

  // ── El listado: artículos y su stock ───────────────────────
  let filasListado: string[][];
  try {
    filasListado = await leerValores(planilla, TAB_LISTADO(), { sinFormato: true });
  } catch (e) {
    return falla(502, `No se pudo leer «${TAB_LISTADO()}»: ${mensaje(e)}`);
  }
  if (filasListado.length < 2) {
    return falla(502, `La pestaña «${TAB_LISTADO()}» vino vacía. No se toca nada.`);
  }

  const idxListado = mapearListado(filasListado[0]);
  if (idxListado.codigo < 0) {
    return falla(502, `«${TAB_LISTADO()}» no tiene una columna de código reconocible.`);
  }

  const articulos: ArticuloLeido[] = [];
  const vistos = new Set<string>();
  let repetidos = 0;
  for (let i = 1; i < filasListado.length; i++) {
    const a = filaDeArticulo(filasListado[i], idxListado, i + 1);
    if (!a) continue;
    // El código es unique: dos filas iguales harían fallar el lote entero con
    // "ON CONFLICT DO UPDATE command cannot affect row a second time".
    if (vistos.has(a.codigo)) { repetidos++; continue; }
    vistos.add(a.codigo);
    articulos.push(a);
  }

  // ── El kardex ──────────────────────────────────────────────
  let filasKardex: string[][];
  try {
    filasKardex = await leerValores(planilla, TAB_KARDEX(), { sinFormato: true });
  } catch (e) {
    return falla(502, `El listado se leyó; el kardex «${TAB_KARDEX()}» no: ${mensaje(e)}`);
  }

  const idxKardex = filasKardex.length ? mapearKardex(filasKardex[0]) : {};
  const movimientos: MovimientoLeido[] = [];
  for (let i = 1; i < filasKardex.length; i++) {
    const m = filaDeMovimiento(filasKardex[i], idxKardex, i + 1);
    if (m) movimientos.push(m);
  }

  // ── El grupo de cada artículo, desde la K ──────────────────
  //
  // La K es una fórmula sobre el código, así que todas las filas de un mismo
  // código tienen que decir lo mismo. Cuando no lo dicen —o cuando el artículo
  // no tiene ninguna fila— el grupo queda en null y se informa: enlazarlo al
  // que se le parece pone el artículo en el total que no es y no se nota nunca.
  const gruposPorCodigo = new Map<string, Set<string>>();
  for (const m of movimientos) {
    if (!m.grupo_raw) continue;
    const s = gruposPorCodigo.get(m.codigo) ?? new Set<string>();
    s.add(m.grupo_raw);
    gruposPorCodigo.set(m.codigo, s);
  }

  const sinGrupo: string[] = [];
  const grupoEnDisputa: string[] = [];
  const grupoDe = (codigo: string): string | null => {
    const s = gruposPorCodigo.get(codigo);
    if (!s || s.size === 0) { sinGrupo.push(codigo); return null; }
    if (s.size > 1) { grupoEnDisputa.push(`${codigo}: ${[...s].join(" / ")}`); return null; }
    return [...s][0];
  };

  const ahora = new Date().toISOString();
  let guardadosArticulos = 0;
  for (let i = 0; i < articulos.length; i += 500) {
    const lote = articulos.slice(i, i + 500).map((a) => ({
      ...a,
      grupo: grupoDe(a.codigo),
      stock_sincronizado_en: ahora,
    }));
    const { error } = await admin
      .from("produccion_envases_articulos")
      .upsert(lote, { onConflict: "codigo" });
    if (error) {
      await registrarSincronizacion({
        modulo: "produccion", recurso: "envases_articulos", ok: false, error: error.message,
      });
      return falla(400, error.message);
    }
    guardadosArticulos += lote.length;
  }

  // ── Los proveedores de envases ─────────────────────────────
  const { proveedores: guardadosProveedores, sinEnlazar } =
    await sincronizarProveedores(admin, planilla);

  // ── Las referencias de color, y su historial ───────────────
  const referencias = await sincronizarReferencias(admin, planilla);

  // ── Los movimientos ────────────────────────────────────────
  const porCodigo = new Map(
    (await traerTodo<{ id: string; codigo: string }>((desde, hasta) =>
      admin.from("produccion_envases_articulos").select("id, codigo").range(desde, hasta)
    )).map((f) => [f.codigo, f.id])
  );

  // Los proveedores del núcleo, sólo para leer. La columna J viene vacía en las
  // 1.398 filas de hoy, pero el alta desde la app la puede llenar.
  const proveedoresNucleo = indiceDeProveedores(
    await traerTodo<{ id: string; nombre: string }>((desde, hasta) =>
      admin.from("proveedores").select("id, nombre").range(desde, hasta)
    )
  );

  let sinArticulo = 0;
  const filas = movimientos.flatMap((m) => {
    const articulo_id = porCodigo.get(m.codigo);
    // Un movimiento de un código que no está en el listado no se puede colgar
    // de ningún artículo. Se cuenta y se sigue.
    if (!articulo_id) { sinArticulo++; return []; }

    return [{
      articulo_id,
      codigo: m.codigo,
      fecha: m.fecha,
      entrada: m.entrada,
      salida: m.salida,
      rotura: m.rotura,
      despacho: m.despacho,
      observacion: m.observacion,
      proveedor_raw: m.proveedor_raw,
      proveedor_id: buscarProveedor(proveedoresNucleo, m.proveedor_raw),
      // `origen` NO viaja, a propósito: en un upsert las columnas que no se
      // mandan no entran en el SET, así que un movimiento cargado en la app y
      // después espejado conserva su 'app' cuando la sincronización relee esa
      // fila. Las filas nuevas toman el default, que es 'planilla'.
      sheets_fila: m.sheets_fila,
    }];
  });

  let guardadosMovimientos = 0;
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await admin
      .from("produccion_envases_movimientos")
      // La condición del índice parcial va nombrada: sin ella Postgres no
      // encuentra el índice como destino del ON CONFLICT.
      .upsert(filas.slice(i, i + 500), { onConflict: "sheets_fila" });
    if (error) {
      await registrarSincronizacion({
        modulo: "produccion", recurso: "envases_movimientos", ok: false, error: error.message,
      });
      return falla(400, error.message);
    }
    guardadosMovimientos += filas.slice(i, i + 500).length;
  }

  await registrarSincronizacion({
    modulo: "produccion", recurso: "envases_articulos", ok: true, filas: guardadosArticulos,
  });
  await registrarSincronizacion({
    modulo: "produccion", recurso: "envases_movimientos", ok: true, filas: guardadosMovimientos,
  });

  return logra({
    articulos: guardadosArticulos,
    articulos_repetidos: repetidos,
    movimientos: guardadosMovimientos,
    movimientos_sin_articulo: sinArticulo,
    proveedores: guardadosProveedores,
    // Los nombres y no el conteo: cuáles son es lo que decide si hay algo que
    // arreglar. Con un número hay que ir a buscarlos.
    proveedores_sin_enlazar: sinEnlazar,
    referencias: referencias.colores,
    referencias_historial: referencias.historial,
    referencias_error: referencias.error ?? null,
    // Artículos cuyo grupo no se pudo establecer. Los que no tienen ningún
    // movimiento van a aparecer siempre acá, y está bien: la K sale del kardex.
    articulos_sin_grupo: sinGrupo,
    // Códigos cuyas filas dicen dos grupos distintos. Eso es una fórmula tocada
    // a mano o una columna corrida, y se arregla en la planilla.
    articulos_con_grupo_en_disputa: grupoEnDisputa,
  });
}

/**
 * A qué proveedor del núcleo corresponde uno de la pestaña.
 *
 * **Primero por CUIT y después por nombre**: el CUIT identifica sin ambigüedad
 * y el nombre no —"Torraco Pablo Javier" en esta pestaña es "Flexi Rigs" en las
 * facturas—. Si ninguno de los dos lo reconoce, `null`: enlazar al que se le
 * parece pone el gasto en el proveedor que no es y no se nota nunca.
 *
 * Exportada y pura para poder probarla: es una decisión, no plomería.
 */
export function enlazarProveedor(
  porCuit: Map<string, string>,
  porNombre: Map<string, string>,
  p: { nombre: string; cuit: string | null }
): string | null {
  if (p.cuit) {
    const porDocumento = porCuit.get(p.cuit);
    if (porDocumento) return porDocumento;
  }
  return buscarProveedor(porNombre, p.nombre);
}

/**
 * Los 16 proveedores de envases. Lo que no se reconoce se informa.
 */
async function sincronizarProveedores(
  admin: ReturnType<typeof createAdminClient>,
  planilla: string
): Promise<{ proveedores: number; sinEnlazar: string[] }> {
  let filas: string[][];
  try {
    filas = await leerValores(planilla, TAB_PROV(), { sinFormato: true });
  } catch {
    // Un fallo acá no corta la sincronización: los artículos y el kardex, que
    // son lo que se mira todos los días, ya entraron.
    return { proveedores: 0, sinEnlazar: [] };
  }
  if (filas.length < 2) return { proveedores: 0, sinEnlazar: [] };

  const leidos: ProveedorLeido[] = [];
  for (let i = 1; i < filas.length; i++) {
    const p = filaDeProveedor(filas[i], filas[0], i + 1);
    if (p) leidos.push(p);
  }

  const delNucleo = await traerTodo<{ id: string; nombre: string; cuit: string | null }>(
    (desde, hasta) => admin.from("proveedores").select("id, nombre, cuit").range(desde, hasta)
  );
  const porNombre = indiceDeProveedores(delNucleo);
  const porCuit = new Map<string, string>();
  for (const p of delNucleo) {
    const c = normalizarCuit(p.cuit);
    if (c && !porCuit.has(c)) porCuit.set(c, p.id);
  }

  const sinEnlazar: string[] = [];
  const lote = leidos.map((p) => {
    const proveedor_id = enlazarProveedor(porCuit, porNombre, p);
    if (!proveedor_id) sinEnlazar.push(p.nombre);
    return { ...p, proveedor_id };
  });

  const { error } = await admin
    .from("produccion_envases_proveedores")
    .upsert(lote, { onConflict: "nombre" });

  return { proveedores: error ? 0 : lote.length, sinEnlazar };
}

/**
 * La pestaña `REFERENCIAS`: color → proveedor, y el historial de cambios.
 *
 * Las dos cosas. La tabla de colores sin su historial miente: hoy el verde es
 * de Bolsera y hasta el 3 de julio de 2026 era de Recuperadora del Sur, así que
 * un bolsón viejo se le atribuiría al proveedor equivocado.
 *
 * La pestaña no tiene encabezados de tabla: la fila 1 es un título, la 2 dice
 * COLOR / PROVEEDOR, y desde la 10 arranca el historial después de la palabra
 * "MODIFICACIONES:". Se lee por esa marca y no por número de fila, para que
 * agregar un color no rompa nada.
 */
async function sincronizarReferencias(
  admin: ReturnType<typeof createAdminClient>,
  planilla: string
): Promise<{ colores: number; historial: number; error?: string }> {
  let filas: string[][];
  try {
    filas = await leerValores(planilla, TAB_REF(), { sinFormato: true });
  } catch (e) {
    return { colores: 0, historial: 0, error: mensaje(e) };
  }

  const corte = filas.findIndex((f) => (f[0] ?? "").toUpperCase().startsWith("MODIFICACIONES"));
  const hasta = corte >= 0 ? corte : filas.length;

  const colores: { color: string; proveedor_nombre: string | null; orden: number; sheets_fila: number }[] = [];
  for (let i = 0; i < hasta; i++) {
    const color = (filas[i]?.[0] ?? "").trim();
    const prov = (filas[i]?.[1] ?? "").trim();
    // Sólo las filas que son un par color/proveedor. El título y el encabezado
    // no lo son.
    if (!color || !prov || color.toUpperCase() === "COLOR") continue;
    colores.push({ color, proveedor_nombre: prov, orden: i, sheets_fila: i + 1 });
  }

  const historial: { texto: string; sheets_fila: number }[] = [];
  for (let i = hasta + 1; i < filas.length; i++) {
    const texto = (filas[i]?.[0] ?? "").trim();
    if (texto) historial.push({ texto, sheets_fila: i + 1 });
  }

  if (colores.length) {
    await admin.from("produccion_envases_referencias").upsert(colores, { onConflict: "color" });
  }
  if (historial.length) {
    await admin
      .from("produccion_envases_referencias_historial")
      .upsert(historial, { onConflict: "sheets_fila" });
  }

  return { colores: colores.length, historial: historial.length };
}
```

- [ ] **Paso 2: Probar el enlace de proveedores**

Crear `lib/produccion/envases/sincronizar.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { enlazarProveedor } from "./sincronizar";

// "Torraco Pablo Javier" en la pestaña de envases es "Flexi Rigs" en las
// facturas: por nombre no se lo reconoce, por CUIT sí.
const POR_CUIT = new Map([["23214811839", "id-flexi"]]);
const POR_NOMBRE = new Map([["flexi rigs", "id-flexi"], ["bralbol", "id-bralbol"]]);

describe("enlazarProveedor", () => {
  it("gana el CUIT, aunque el nombre no se parezca en nada", () => {
    expect(enlazarProveedor(POR_CUIT, POR_NOMBRE, {
      nombre: "Torraco Pablo Javier", cuit: "23214811839",
    })).toBe("id-flexi");
  });

  it("sin CUIT, cae al nombre", () => {
    expect(enlazarProveedor(POR_CUIT, POR_NOMBRE, {
      nombre: "Bralbol", cuit: null,
    })).toBe("id-bralbol");
  });

  it("con un CUIT que no está, igual prueba el nombre", () => {
    expect(enlazarProveedor(POR_CUIT, POR_NOMBRE, {
      nombre: "Bralbol", cuit: "30715153528",
    })).toBe("id-bralbol");
  });

  it("si no lo reconoce, null: no enlaza al que se le parece", () => {
    expect(enlazarProveedor(POR_CUIT, POR_NOMBRE, {
      nombre: "Pro bags", cuit: null,
    })).toBeNull();
  });
});
```

```bash
npx vitest run lib/produccion/envases/sincronizar.test.ts
```

Esperado: PASS, 4 tests.

- [ ] **Paso 3: Escribir la ruta**

```ts
// app/api/produccion/envases/sync/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tieneAccesoProduccion } from "@/lib/produccion/auth";
import { sincronizarEnvases } from "@/lib/produccion/envases/sincronizar";

/**
 * Traer de la planilla de envases.
 *
 * Es la misma función que corre la carga inicial: la primera vez trae los 26
 * artículos y los 1.398 movimientos, y de ahí en adelante refresca.
 *
 * Alcanza con tener acceso al módulo: traer de la planilla no cambia lo que la
 * planilla dice —sólo lo copia— así que no es una operación de edición.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await tieneAccesoProduccion(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Producción" }, { status: 403 });
  }

  const r = await sincronizarEnvases();
  return r.ok
    ? NextResponse.json(r.datos)
    : NextResponse.json({ error: r.error, ...(r.datos ?? {}) }, { status: r.status });
}
```

- [ ] **Paso 4: Comprobar contra la planilla real**

Las credenciales de Google están en `.env.local`, así que esto se mide en vez de
suponerse. **Leer sí; escribir no** — es la planilla de producción.

Agregar a `.env.local`:

```
GOOGLE_SHEETS_ENVASES_ID=1NDVbtfG8zbC7AaJ-_tr1VUrKOsg23Lsr8-NeoNBvJAI
```

Y correr la sincronización de verdad, con un script temporal que se borra
después:

```bash
cat > scripts/tmp-sync-envases.mts <<'EOF'
import { readFileSync } from "node:fs";
import { sincronizarEnvases } from "../lib/produccion/envases/sincronizar.ts";
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n")) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
console.log(JSON.stringify(await sincronizarEnvases(), null, 2));
EOF
npx tsx scripts/tmp-sync-envases.mts; rm -f scripts/tmp-sync-envases.mts
```

Esperado, y hay que verificar los números uno por uno:

```
articulos: 26
movimientos: 1398
movimientos_sin_articulo: 0
proveedores: 16
referencias: 5
articulos_sin_grupo: ["00011"]   ← el SHARMAR, que no tiene movimientos
articulos_con_grupo_en_disputa: []
```

Si `movimientos` no da 1398, el parser está descartando filas buenas: comparar
contra el conteo con `leerValores` crudo antes de tocar nada. Si
`articulos_con_grupo_en_disputa` trae algo, la columna K está corrida — no
arreglarlo en el código, avisarlo.

- [ ] **Paso 5: Correr la suite entera y los tipos**

```bash
npx vitest run
npx tsc --noEmit
```

Esperado: todo verde. Si fallan archivos que no tocaste, mirar `git status`
antes de arreglarlos: puede ser un refactor en curso de otra sesión, y
arreglarlo es pisarlo.

- [ ] **Paso 6: Commitear**

```bash
git commit --only lib/produccion/envases/sincronizar.ts lib/produccion/envases/sincronizar.test.ts app/api/produccion/envases/sync/route.ts -m "feat(produccion): traer de la planilla de envases

Es tambien la carga inicial: la primera corrida trae 26 articulos, 1.398
movimientos, 16 proveedores y las referencias. Sin importador aparte, que es
como las dos copias del parser se separan.

El grupo de cada articulo sale de la K y se exige que todas las filas de un
mismo codigo digan lo mismo: si dicen dos cosas, o si el articulo no tiene
movimientos, queda en null y se informa. Los proveedores se enganchan primero
por CUIT y despues por nombre, porque en esta pestaña 'Torraco Pablo Javier' es
'Flexi Rigs' en las facturas.

Medido contra la planilla real: 26 / 1.398 / 16 / 5, y el unico articulo sin
grupo es el 00011, que nunca tuvo un movimiento.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Tarea 6: Cargar un movimiento desde la app

**Archivos:**
- Crear: `app/api/produccion/envases/movimientos/route.ts`

- [ ] **Paso 1: Escribir la ruta**

```ts
// app/api/produccion/envases/movimientos/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puedeEditarProduccion } from "@/lib/produccion/auth";
import { espejarMovimiento } from "@/lib/produccion/envases/espejo";

/**
 * Cargar un movimiento de envases.
 *
 * Dos cosas pasan acá, y la segunda no es opcional aunque lo parezca:
 *
 * 1. La fila en `produccion_envases_movimientos`.
 * 2. El **espejo a la planilla**. La planilla manda: un movimiento que no llega
 *    allá no existe, porque la próxima sincronización lee el stock de la
 *    fórmula —que no lo incluye— y lo borra de hecho.
 *
 * Por eso el espejo **no corre en segundo plano**: se espera, se anota el
 * pendiente si falló, y se le dice a quien cargó. Es un segundo más de espera a
 * cambio de que nadie cargue algo que se va a evaporar sin aviso.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarProduccion(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para cargar movimientos" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.articulo_id) {
    return NextResponse.json({ error: "Falta el artículo" }, { status: 400 });
  }

  const numero = (v: unknown): number => {
    const n = Number(v ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const entrada = numero(body.entrada);
  const salida = numero(body.salida);
  const rotura = numero(body.rotura);
  const despacho = numero(body.despacho);

  // La misma regla que el check de la tabla, para que el error se lea en
  // castellano en vez de llegar como una violación de constraint.
  if (entrada + salida + rotura + despacho <= 0) {
    return NextResponse.json(
      { error: "El movimiento no mueve nada: cargá al menos un número." },
      { status: 400 }
    );
  }

  const { data: articulo } = await supabase
    .from("produccion_envases_articulos")
    .select("id, codigo")
    .eq("id", body.articulo_id)
    .single();
  if (!articulo) {
    return NextResponse.json({ error: "El artículo no existe" }, { status: 400 });
  }

  const fecha = typeof body.fecha === "string" && body.fecha ? body.fecha.slice(0, 10) : null;

  const { data: mov, error } = await supabase
    .from("produccion_envases_movimientos")
    .insert({
      articulo_id: articulo.id,
      codigo: articulo.codigo,
      fecha,
      entrada, salida, rotura, despacho,
      observacion: typeof body.observacion === "string" ? body.observacion.trim() || null : null,
      proveedor_raw: typeof body.proveedor === "string" ? body.proveedor.trim() || null : null,
      creado_por: user.id,
      origen: "app",
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const espejo = await espejarMovimiento({
    codigo: articulo.codigo,
    entrada, salida, rotura, despacho,
    fecha,
    observacion: mov.observacion,
    proveedor: mov.proveedor_raw,
  });

  // El pendiente se anota o se limpia; nunca queda a medias.
  await supabase
    .from("produccion_envases_movimientos")
    .update(
      espejo.ok
        ? { sheets_fila: espejo.fila, sheets_pendiente: null, sheets_pendiente_en: null }
        : {
            sheets_pendiente: espejo.error ?? "no se pudo escribir",
            sheets_pendiente_en: new Date().toISOString(),
          }
    )
    .eq("id", mov.id);

  return NextResponse.json({
    data: { ...mov, sheets_fila: espejo.ok ? espejo.fila : null },
    // Con lo que dijo Google, sin traducir. La pantalla lo muestra: un fallo de
    // escritura no es un console.warn.
    planilla_error: espejo.ok ? null : espejo.error,
  });
}
```

- [ ] **Paso 2: Verificar tipos**

```bash
npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Paso 3: Commitear**

```bash
git commit --only app/api/produccion/envases/movimientos/route.ts -m "feat(produccion): cargar un movimiento de envases desde la app

El espejo a la planilla se espera, no corre en segundo plano: la planilla manda,
asi que un movimiento que no llega alla no existe —la proxima sincronizacion lee
el stock de la formula, que no lo incluye, y lo borra de hecho—. Si falla queda
sheets_pendiente con lo que dijo Google sin traducir, y la respuesta lo trae
para que la pantalla lo muestre.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Tarea 7: La pantalla de stock

**Archivos:**
- Crear: `app/(app)/produccion/envases/page.tsx`
- Crear: `app/(app)/produccion/envases/StockClient.tsx`
- Crear: `app/(app)/produccion/envases/TraerDeLaPlanilla.tsx`

**Sin ruta de API para leer.** Son 26 artículos: el Server Component los trae y
los pasa. Inventario tiene `/api/inventario/articulos` porque allá son ~2.800 y
la búsqueda va contra la base; acá la búsqueda es sobre una lista que entra
entera en la pantalla, y una ruta más sería plomería sin trabajo que hacer.

- [ ] **Paso 1: El Server Component**

```tsx
// app/(app)/produccion/envases/page.tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelProduccionDe } from "@/lib/produccion/auth";
import { ultimaSincronizacionDe } from "@/lib/core/sincronizaciones";
import StockClient, { type ArticuloEnPantalla } from "./StockClient";

export default async function EnvasesPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const nivel = await nivelProduccionDe(supabase, user.id);
  if (!nivel) redirect("/");

  // La cadena del select va literal y no armada en una variable: con una
  // variable, Supabase pierde la inferencia y todo lo que sale queda como error
  // de string.
  const { data } = await supabase
    .from("produccion_envases_articulos")
    .select("id, codigo, descripcion, grupo, stock_actual, stock_seguridad, faltante, stock_sincronizado_en")
    .eq("activo", true)
    .order("faltante", { ascending: false })
    .order("codigo");

  // Cuándo se leyó la planilla. Es parte de lo que hay que saber para leer el
  // stock: el número puede tener horas.
  const sync = await ultimaSincronizacionDe(supabase, "produccion", "envases_articulos");

  return (
    <StockClient
      articulos={(data ?? []) as ArticuloEnPantalla[]}
      puedeOperar={nivel === "edicion" || nivel === "admin"}
      sync={sync}
    />
  );
}
```

- [ ] **Paso 2: El cliente**

```tsx
// app/(app)/produccion/envases/StockClient.tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import TraerDeLaPlanilla from "./TraerDeLaPlanilla";
import type { UltimaSync } from "@/lib/core/sincronizaciones";

export interface ArticuloEnPantalla {
  id: string;
  codigo: string;
  descripcion: string;
  grupo: string | null;
  stock_actual: number;
  stock_seguridad: number;
  faltante: number;
  stock_sincronizado_en: string | null;
}

/**
 * El stock de envases.
 *
 * Ordenado por faltante, que es lo que ordena el trabajo: lo primero que se ve
 * es lo que hay que comprar.
 *
 * El número **es lo que dijo la planilla**, no un cálculo del SdG: la columna de
 * stock allá es una fórmula sobre el kardex y eso la vuelve el stock consolidado
 * correcto. Por eso la fecha de la última lectura va al lado y no escondida —un
 * número sin fecha se lee como si fuera de ahora—.
 */
export default function StockClient({
  articulos, puedeOperar, sync,
}: {
  articulos: ArticuloEnPantalla[];
  puedeOperar: boolean;
  sync: UltimaSync | null;
}) {
  const [q, setQ] = useState("");
  const [soloFaltantes, setSoloFaltantes] = useState(false);

  const visibles = useMemo(() => {
    const termino = q.trim().toLowerCase();
    return articulos.filter((a) => {
      if (soloFaltantes && a.faltante <= 0) return false;
      if (!termino) return true;
      return (
        a.codigo.toLowerCase().includes(termino) ||
        a.descripcion.toLowerCase().includes(termino) ||
        (a.grupo ?? "").toLowerCase().includes(termino)
      );
    });
  }, [articulos, q, soloFaltantes]);

  return (
    <div className="mx-auto max-w-5xl space-y-4 md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Stock de envases</h1>
          <p className="text-sm text-slate-500">
            Lo que hay, según la última lectura de la planilla.
          </p>
        </div>
        {puedeOperar && (
          <Link
            href="/produccion/envases/movimientos"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            Cargar movimiento
          </Link>
        )}
      </div>

      <TraerDeLaPlanilla sync={sync} />

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por código, descripción o grupo"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={soloFaltantes}
            onChange={(e) => setSoloFaltantes(e.target.checked)}
          />
          Sólo faltantes
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Descripción</th>
              <th className="px-3 py-2">Grupo</th>
              <th className="px-3 py-2 text-right">Stock</th>
              <th className="px-3 py-2 text-right">Seguridad</th>
              <th className="px-3 py-2 text-right">Falta</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((a) => (
              <tr key={a.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-mono text-xs text-slate-500">{a.codigo}</td>
                <td className="px-3 py-2 text-slate-900">{a.descripcion}</td>
                <td className="px-3 py-2 text-slate-500">
                  {/* Sin grupo no es un error del artículo: la columna que
                      agrupa vive en el kardex, así que un artículo que nunca se
                      movió no tiene ninguno. Se dice, no se disimula. */}
                  {a.grupo ?? <span className="italic text-slate-400">sin grupo</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{a.stock_actual}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                  {a.stock_seguridad}
                </td>
                <td
                  className={`px-3 py-2 text-right tabular-nums ${
                    a.faltante > 0 ? "font-semibold text-red-600" : "text-slate-400"
                  }`}
                >
                  {a.faltante > 0 ? a.faltante : "—"}
                </td>
              </tr>
            ))}
            {visibles.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                  {articulos.length === 0
                    ? "Todavía no se trajo nada de la planilla."
                    : "Ningún artículo coincide."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Paso 3: El botón de traer**

```tsx
// app/(app)/produccion/envases/TraerDeLaPlanilla.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import UltimaSincronizacion from "@/components/UltimaSincronizacion";
import type { UltimaSync } from "@/lib/core/sincronizaciones";

/**
 * El botón de traer de la planilla, con la fecha al lado y no solo.
 *
 * Un botón de actualizar sin decir de cuándo es lo que hay obliga a apretarlo
 * por las dudas.
 *
 * **Lo que devuelve se muestra entero, incluido lo que no reconoció.** Un
 * resumen que sólo dice "listo" esconde justo lo que hay que arreglar: los
 * artículos sin grupo, los que tienen el grupo en disputa y los proveedores que
 * no engancharon con el catálogo del núcleo.
 */
export default function TraerDeLaPlanilla({ sync }: { sync: UltimaSync | null }) {
  const router = useRouter();
  const [sincronizando, setSincronizando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);

  async function sincronizar() {
    setSincronizando(true);
    setAviso(null);
    setFallo(false);

    const res = await fetch("/api/produccion/envases/sync", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setSincronizando(false);

    if (!res.ok) {
      setFallo(true);
      setAviso(body.error ?? "No se pudo sincronizar.");
      return;
    }

    const partes = [
      `${body.articulos} artículos`,
      `${body.movimientos} movimientos`,
      `${body.proveedores} proveedores`,
    ];
    if (body.movimientos_sin_articulo > 0) {
      partes.push(`${body.movimientos_sin_articulo} movimientos de un código que no está en el listado`);
    }
    const sinGrupo = (body.articulos_sin_grupo ?? []) as string[];
    if (sinGrupo.length) partes.push(`sin grupo: ${sinGrupo.join(", ")}`);
    const enDisputa = (body.articulos_con_grupo_en_disputa ?? []) as string[];
    if (enDisputa.length) partes.push(`grupo en disputa: ${enDisputa.join("; ")}`);
    const sinEnlazar = (body.proveedores_sin_enlazar ?? []) as string[];
    if (sinEnlazar.length) partes.push(`proveedores sin enganchar: ${sinEnlazar.join(", ")}`);
    // Con lo que dijo Google, sin traducir.
    if (body.referencias_error) partes.push(`REFERENCIAS: ${body.referencias_error}`);

    setAviso(partes.join(" · "));
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={sincronizar}
          disabled={sincronizando}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
        >
          {sincronizando ? "Trayendo…" : "Traer de la planilla"}
        </button>
        <UltimaSincronizacion sync={sync} />
      </div>
      {aviso && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            fallo
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-slate-200 bg-slate-50 text-slate-700"
          }`}
        >
          {aviso}
        </div>
      )}
    </div>
  );
}
```

Si `components/UltimaSincronizacion` pide props distintas de `{ sync }`, mirar
cómo lo llama `app/(app)/inventario/TraerDeLaPlanilla.tsx` y usar esa forma: es
el mismo componente y la firma manda.

- [ ] **Paso 4: Verificar que compila**

```bash
npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Paso 5: Commitear**

```bash
git commit --only "app/(app)/produccion/envases/page.tsx" "app/(app)/produccion/envases/StockClient.tsx" "app/(app)/produccion/envases/TraerDeLaPlanilla.tsx" -m "feat(produccion): la pantalla de stock de envases

Ordenada por faltante, que es lo que ordena el trabajo, y con la fecha de la
ultima lectura a la vista: el stock es lo que dijo la planilla, no un calculo, y
sin la fecha el numero se lee como si fuera de ahora.

Sin ruta de API para leer: son 26 articulos y los trae el Server Component. El
boton muestra entero lo que devuelve la sincronizacion, incluido lo que no
reconocio — un resumen que solo dice 'listo' esconde lo que hay que arreglar.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Tarea 8: El kardex, con el alta

**Archivos:**
- Crear: `app/(app)/produccion/envases/movimientos/page.tsx`
- Crear: `app/(app)/produccion/envases/movimientos/MovimientosClient.tsx`

- [ ] **Paso 1: El Server Component**

```tsx
// app/(app)/produccion/envases/movimientos/page.tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelProduccionDe } from "@/lib/produccion/auth";
import { traerTodo } from "@/lib/core/paginado";
import MovimientosClient, {
  type MovimientoEnPantalla, type ArticuloDelSelector,
} from "./MovimientosClient";

export default async function MovimientosPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const nivel = await nivelProduccionDe(supabase, user.id);
  if (!nivel) redirect("/");

  const [articulos, movimientos] = await Promise.all([
    traerTodo<ArticuloDelSelector>((desde, hasta) =>
      supabase
        .from("produccion_envases_articulos")
        .select("id, codigo, descripcion, grupo")
        .eq("activo", true)
        .order("codigo")
        .range(desde, hasta)
    ),
    // `traerTodo` y no un `.limit()`: son 1.398 filas y PostgREST corta en 1000
    // sin avisar. Un `.limit(3000)` devuelve 1000 y la pantalla miente sin que
    // nada falle.
    traerTodo<MovimientoEnPantalla>((desde, hasta) =>
      supabase
        .from("produccion_envases_movimientos")
        .select("id, articulo_id, codigo, fecha, entrada, salida, rotura, despacho, observacion, origen, sheets_pendiente")
        .order("fecha", { ascending: false })
        .range(desde, hasta)
    ),
  ]);

  return (
    <MovimientosClient
      articulos={articulos}
      movimientos={movimientos}
      puedeOperar={nivel === "edicion" || nivel === "admin"}
    />
  );
}
```

- [ ] **Paso 2: El cliente, con el formulario de alta**

```tsx
// app/(app)/produccion/envases/movimientos/MovimientosClient.tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export interface ArticuloDelSelector {
  id: string;
  codigo: string;
  descripcion: string;
  grupo: string | null;
}

export interface MovimientoEnPantalla {
  id: string;
  articulo_id: string;
  codigo: string | null;
  fecha: string | null;
  entrada: number;
  salida: number;
  rotura: number;
  despacho: number;
  observacion: string | null;
  origen: string;
  /** Por qué no llegó a la planilla. Null = está escrito. */
  sheets_pendiente: string | null;
}

const hoy = () => new Date().toISOString().slice(0, 10);

/**
 * El kardex de envases y el alta de un movimiento.
 *
 * Una fila lleva **cuatro números**, no un tipo y una cantidad: así está la
 * planilla, y hay filas con entrada y salida a la vez. La rotura y el despacho
 * se cargan y **no descuentan stock**, igual que allá.
 */
export default function MovimientosClient({
  articulos, movimientos, puedeOperar,
}: {
  articulos: ArticuloDelSelector[];
  movimientos: MovimientoEnPantalla[];
  puedeOperar: boolean;
}) {
  const router = useRouter();

  const [filtroArticulo, setFiltroArticulo] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [avisoPlanilla, setAvisoPlanilla] = useState("");

  const [form, setForm] = useState({
    articulo_id: "", entrada: "", salida: "", rotura: "", despacho: "",
    fecha: hoy(), observacion: "", proveedor: "",
  });

  const descripcionDe = useMemo(
    () => new Map(articulos.map((a) => [a.id, a.descripcion])),
    [articulos]
  );

  const visibles = useMemo(
    () =>
      movimientos.filter((m) => {
        if (filtroArticulo && m.articulo_id !== filtroArticulo) return false;
        const dia = m.fecha?.slice(0, 10);
        if (desde && (!dia || dia < desde)) return false;
        if (hasta && (!dia || dia > hasta)) return false;
        return true;
      }),
    [movimientos, filtroArticulo, desde, hasta]
  );

  const numeros = Number(form.entrada || 0) + Number(form.salida || 0) +
                  Number(form.rotura || 0) + Number(form.despacho || 0);
  const puedeGuardar = Boolean(form.articulo_id) && numeros > 0 && !guardando;

  async function guardar() {
    setGuardando(true);
    setError("");
    setAvisoPlanilla("");

    const res = await fetch("/api/produccion/envases/movimientos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const body = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) { setError(body.error ?? "No se pudo guardar."); return; }

    // El movimiento se guardó pero no llegó a la planilla. No es un detalle: la
    // planilla manda, así que hasta que alguien lo cargue allá a mano el stock
    // no lo incluye. Se muestra lo que dijo Google **sin traducir**.
    if (body.planilla_error) {
      setAvisoPlanilla(
        `Se guardó, pero no se pudo escribir en la planilla: ${body.planilla_error}`
      );
    } else {
      setAbierto(false);
    }
    setForm({ ...form, entrada: "", salida: "", rotura: "", despacho: "", observacion: "" });
    router.refresh();
  }

  const campo = (k: keyof typeof form, etiqueta: string, tipo = "number") => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-slate-600">{etiqueta}</span>
      <input
        type={tipo}
        min={tipo === "number" ? 0 : undefined}
        value={form[k]}
        onChange={(e) => setForm({ ...form, [k]: e.target.value })}
        className="rounded-lg border border-slate-300 px-3 py-2"
      />
    </label>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-4 md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Movimientos de envases</h1>
          <p className="text-sm text-slate-500">
            {visibles.length} de {movimientos.length}
          </p>
        </div>
        {puedeOperar && (
          <button
            onClick={() => setAbierto((v) => !v)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            {abierto ? "Cerrar" : "Cargar movimiento"}
          </button>
        )}
      </div>

      {abierto && (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Artículo</span>
            <select
              value={form.articulo_id}
              onChange={(e) => setForm({ ...form, articulo_id: e.target.value })}
              className="rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">Elegí uno</option>
              {articulos.map((a) => (
                <option key={a.id} value={a.id}>{a.codigo} — {a.descripcion}</option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {campo("entrada", "Entradas")}
            {campo("salida", "Salidas")}
            {campo("rotura", "Rotura")}
            {campo("despacho", "Despacho")}
          </div>
          <p className="text-xs text-slate-500">
            La rotura y el despacho se guardan y <strong>no descuentan stock</strong>,
            igual que en la planilla. El stock lo mueven las entradas y las salidas.
          </p>

          <div className="grid gap-3 md:grid-cols-2">
            {campo("fecha", "Fecha", "date")}
            {campo("proveedor", "Proveedor", "text")}
          </div>
          {campo("observacion", "Observación", "text")}

          <button
            onClick={guardar}
            disabled={!puedeGuardar}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Guardar"}
          </button>
          {numeros <= 0 && (
            <p className="text-xs text-slate-500">Cargá al menos uno de los cuatro números.</p>
          )}
          {error && <p className="text-sm text-red-700">{error}</p>}
        </div>
      )}

      {avisoPlanilla && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {avisoPlanilla}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Artículo</span>
          <select
            value={filtroArticulo}
            onChange={(e) => setFiltroArticulo(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2"
          >
            <option value="">Todos</option>
            {articulos.map((a) => (
              <option key={a.id} value={a.id}>{a.codigo} — {a.descripcion}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Desde</span>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
                 className="rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Hasta</span>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
                 className="rounded-lg border border-slate-300 px-3 py-2" />
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Artículo</th>
              <th className="px-3 py-2 text-right">Entra</th>
              <th className="px-3 py-2 text-right">Sale</th>
              <th className="px-3 py-2 text-right">Rotura</th>
              <th className="px-3 py-2 text-right">Despacho</th>
              <th className="px-3 py-2">Observación</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((m) => (
              <tr
                key={m.id}
                className={`border-t border-slate-100 ${m.sheets_pendiente ? "bg-amber-50" : ""}`}
              >
                <td className="px-3 py-2 whitespace-nowrap text-slate-500">{m.fecha ?? "—"}</td>
                <td className="px-3 py-2 text-slate-900">
                  {descripcionDe.get(m.articulo_id) ?? m.codigo}
                  {m.sheets_pendiente && (
                    <span className="block text-xs text-amber-800">
                      No llegó a la planilla: {m.sheets_pendiente}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{m.entrada || ""}</td>
                <td className="px-3 py-2 text-right tabular-nums">{m.salida || ""}</td>
                <td className="px-3 py-2 text-right tabular-nums">{m.rotura || ""}</td>
                <td className="px-3 py-2 text-right tabular-nums">{m.despacho || ""}</td>
                <td className="px-3 py-2 text-slate-500">{m.observacion}</td>
              </tr>
            ))}
            {visibles.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  Ningún movimiento con esos filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Paso 3: Verificar que compila**

```bash
npx tsc --noEmit
```

- [ ] **Paso 4: Commitear**

```bash
git commit --only "app/(app)/produccion/envases/movimientos/page.tsx" "app/(app)/produccion/envases/movimientos/MovimientosClient.tsx" -m "feat(produccion): el kardex de envases y el alta de un movimiento

Con traerTodo: son 1.398 filas y PostgREST corta en 1000 sin avisar, asi que un
limit devolveria 1000 y la pantalla mentiria sin que nada falle.

Las filas que no llegaron a la planilla van marcadas con el motivo a la vista y
sin traducir lo que dijo Google: hasta que alguien las cargue a mano alla, el
stock no las incluye.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Tarea 9: La pantalla del resumen por período

**Archivos:**
- Crear: `app/(app)/produccion/envases/periodo/page.tsx`
- Crear: `app/(app)/produccion/envases/periodo/PeriodoClient.tsx`

- [ ] **Paso 1: El Server Component**

```tsx
// app/(app)/produccion/envases/periodo/page.tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelProduccionDe } from "@/lib/produccion/auth";
import { traerTodo } from "@/lib/core/paginado";
import type {
  ArticuloDelInforme, MovimientoDelInforme,
} from "@/lib/produccion/envases/informe";
import PeriodoClient from "./PeriodoClient";

export default async function PeriodoPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  if (!(await nivelProduccionDe(supabase, user.id))) redirect("/");

  const [articulos, movimientos] = await Promise.all([
    traerTodo<ArticuloDelInforme>((desde, hasta) =>
      supabase
        .from("produccion_envases_articulos")
        .select("id, codigo, grupo, stock_actual")
        .eq("activo", true)
        .range(desde, hasta)
    ),
    traerTodo<MovimientoDelInforme>((desde, hasta) =>
      supabase
        .from("produccion_envases_movimientos")
        .select("articulo_id, fecha, entrada, salida, rotura, despacho")
        .range(desde, hasta)
    ),
  ]);

  return <PeriodoClient articulos={articulos} movimientos={movimientos} />;
}
```

- [ ] **Paso 2: El cliente**

```tsx
// app/(app)/produccion/envases/periodo/PeriodoClient.tsx
"use client";

import { useMemo, useState } from "react";
import {
  resumirPorGrupo,
  type ArticuloDelInforme, type MovimientoDelInforme,
} from "@/lib/produccion/envases/informe";

/** El primer día del mes en curso, que es el rango que se mira casi siempre. */
function arranque(): { desde: string; hasta: string } {
  const hoy = new Date();
  const primero = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { desde: iso(primero), hasta: iso(hoy) };
}

export default function PeriodoClient({
  articulos, movimientos,
}: {
  articulos: ArticuloDelInforme[];
  movimientos: MovimientoDelInforme[];
}) {
  const inicial = arranque();
  const [desde, setDesde] = useState(inicial.desde);
  const [hasta, setHasta] = useState(inicial.hasta);

  const filas = useMemo(
    () => resumirPorGrupo(articulos, movimientos, { desde, hasta }),
    [articulos, movimientos, desde, hasta]
  );

  return (
    <div className="mx-auto max-w-5xl space-y-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Envases por período</h1>
        <p className="text-sm text-slate-500">
          Lo que entró y salió de cada grupo entre las dos fechas.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Desde</span>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
                 className="rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Hasta</span>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
                 className="rounded-lg border border-slate-300 px-3 py-2" />
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-3 py-2">Grupo</th>
              <th className="px-3 py-2 text-right">Ingresos</th>
              <th className="px-3 py-2 text-right">Egresos</th>
              <th className="px-3 py-2 text-right">Rotura</th>
              <th className="px-3 py-2 text-right">Despacho</th>
              <th className="px-3 py-2 text-right">Stock hoy</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.grupo ?? "sin-grupo"} className="border-t border-slate-100">
                <td className="px-3 py-2 text-slate-900">
                  {f.grupo ?? <span className="italic text-slate-500">Sin grupo</span>}
                  <span className="ml-2 text-xs text-slate-400">
                    {f.articulos} {f.articulos === 1 ? "artículo" : "artículos"}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{f.ingresos}</td>
                <td className="px-3 py-2 text-right tabular-nums">{f.egresos}</td>
                <td className="px-3 py-2 text-right tabular-nums">{f.rotura}</td>
                <td className="px-3 py-2 text-right tabular-nums">{f.despacho}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">{f.stock}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Las dos aclaraciones van en la pantalla y no sólo en el código: la
          primera la lleva la planilla al pie, y sin la segunda el primero que
          compare las dos tablas reporta un bug del SdG que no existe. */}
      <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <p>
          <strong>El stock es el de hoy</strong>, no la diferencia entre los ingresos
          y los egresos del período.
        </p>
        <p>
          Los bolsones nuevos se cuentan en <strong>un solo grupo</strong>. La planilla
          los cuenta en dos —agrupa por el texto de la descripción, y
          &ldquo;NUEVOS … (1,20 P 02)&rdquo; cae en los dos lados—, así que sus totales
          van a ser más altos que estos.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Paso 3: Verificar que compila**

```bash
npx tsc --noEmit
```

- [ ] **Paso 4: Commitear**

```bash
git commit --only "app/(app)/produccion/envases/periodo/page.tsx" "app/(app)/produccion/envases/periodo/PeriodoClient.tsx" -m "feat(produccion): el resumen de envases por periodo

Con las dos aclaraciones escritas en la pantalla y no solo en el codigo: que el
stock es el de hoy y no el del periodo, y que la planilla cuenta los bolsones
nuevos dos veces. Sin la segunda, el primero que compare las dos tablas reporta
un bug del SdG que no existe.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Tarea 10: Proveedores y referencias de color

**Archivos:**
- Crear: `app/(app)/produccion/envases/proveedores/page.tsx`

Una sola pantalla y sin cliente: son tres tablas que se leen, sin filtros ni
estado. Un Server Component alcanza.

- [ ] **Paso 1: La pantalla**

```tsx
// app/(app)/produccion/envases/proveedores/page.tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelProduccionDe } from "@/lib/produccion/auth";

interface Proveedor {
  id: string;
  nombre: string;
  tipos: string | null;
  contacto_nombre: string | null;
  contacto_tel: string | null;
  cuit: string | null;
  proveedor_id: string | null;
}

export default async function ProveedoresDeEnvasesPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  if (!(await nivelProduccionDe(supabase, user.id))) redirect("/");

  const [{ data: proveedores }, { data: referencias }, { data: historial }] = await Promise.all([
    supabase
      .from("produccion_envases_proveedores")
      .select("id, nombre, tipos, contacto_nombre, contacto_tel, cuit, proveedor_id")
      .order("nombre"),
    supabase
      .from("produccion_envases_referencias")
      .select("id, color, proveedor_nombre")
      .order("orden"),
    supabase
      .from("produccion_envases_referencias_historial")
      .select("id, texto")
      .order("sheets_fila"),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-8 md:p-6">
      <section className="space-y-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Proveedores de envases</h1>
          <p className="text-sm text-slate-500">
            De la pestaña <code>PROVEEDORES</code> de la planilla.
          </p>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-3 py-2">Proveedor</th>
                <th className="px-3 py-2">Qué provee</th>
                <th className="px-3 py-2">Contacto</th>
                <th className="px-3 py-2">CUIT</th>
              </tr>
            </thead>
            <tbody>
              {(proveedores ?? []).map((p: Proveedor) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-900">
                    {p.nombre}
                    {/* No está enganchado con el catálogo del núcleo. Se dice
                        porque tiene arreglo: cargarle el CUIT en `proveedores`.
                        Callarlo lo deja sin enganchar para siempre. */}
                    {!p.proveedor_id && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                        sin enganchar
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{p.tipos}</td>
                  <td className="px-3 py-2 text-slate-500">
                    {p.contacto_nombre} {p.contacto_tel}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">{p.cuit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">De qué color es cada bolsón</h2>
          <p className="text-sm text-slate-500">
            La referencia es independiente del tamaño del bolsón.
          </p>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-3 py-2">Color</th>
                <th className="px-3 py-2">Proveedor</th>
              </tr>
            </thead>
            <tbody>
              {(referencias ?? []).map((r: { id: string; color: string; proveedor_nombre: string | null }) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-900">{r.color}</td>
                  <td className="px-3 py-2 text-slate-500">{r.proveedor_nombre}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* El historial va debajo de la tabla y no escondido: la tabla sola
            miente sobre los bolsones viejos. Hoy el verde es de Bolsera, y
            hasta el 3/7/2026 era de Recuperadora del Sur. */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-sm font-medium text-slate-700">Cambios</p>
          <p className="mt-1 text-xs text-slate-500">
            El color de hoy no es el de siempre: para saber de quién es un bolsón
            viejo hay que mirar acá.
          </p>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            {(historial ?? []).map((h: { id: string; texto: string }) => (
              <li key={h.id}>{h.texto}</li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Paso 2: Verificar que compila**

```bash
npx tsc --noEmit
```

- [ ] **Paso 3: Commitear**

```bash
git commit --only "app/(app)/produccion/envases/proveedores/page.tsx" -m "feat(produccion): proveedores de envases y la referencia de color

La referencia va con su historial debajo: hoy el verde es de Bolsera y hasta el
3 de julio era de Recuperadora del Sur, asi que la tabla sola le atribuiria un
bolson viejo al proveedor equivocado.

Los proveedores que no engancharon con el catalogo del nucleo van marcados: es
lo que hay que arreglar, y el arreglo es cargarles el CUIT en `proveedores`.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Tarea 11: El menú, las variables y la documentación

**Archivos:**
- Modificar: `lib/core/nav.ts` (el ítem "Producción", alrededor de la línea 184)
- Modificar: `components/Sidebar.tsx` (el mapa `ICONOS`)
- Modificar: `docs/VARIABLES-VERCEL.md`
- Modificar: `docs/PRODUCCION.md`
- Modificar: `CLAUDE.md`

- [ ] **Paso 1: El menú**

En `lib/core/nav.ts`, dentro de `children` de "Producción", después de
"Resúmenes":

```ts
      {
        label: "Envases",
        href: "/produccion/envases",
        modulo: "produccion",
        children: [
          { label: "Stock", href: "/produccion/envases", modulo: "produccion" },
          { label: "Movimientos", href: "/produccion/envases/movimientos", modulo: "produccion" },
          { label: "Por período", href: "/produccion/envases/periodo", modulo: "produccion" },
          { label: "Proveedores", href: "/produccion/envases/proveedores", modulo: "produccion" },
        ],
      },
```

En `components/Sidebar.tsx`, agregar al mapa `ICONOS` (si no, caen todos en
`IconDash` y el menú deja de distinguirse de un vistazo):

```ts
  "Envases": IconClipboard,
  "Stock": IconList,
  "Movimientos": IconBolt,
  "Por período": IconCalendar,
  "Proveedores": IconUsers,
```

**Ojo:** `"Por período"` y `"Proveedores"` puede que ya existan en el mapa por
otro módulo — los íconos se reusan entre módulos cuando el concepto es el mismo.
Revisar antes de agregar, y no duplicar la clave.

- [ ] **Paso 2: Las variables**

Agregar a la tabla de `docs/VARIABLES-VERCEL.md`, después de las de Producción:

| Variable | Para qué | Cómo se saca |
|---|---|---|
| `GOOGLE_SHEETS_ENVASES_ID` | La planilla de stock de envases: `1NDVbtfG8zbC7AaJ-_tr1VUrKOsg23Lsr8-NeoNBvJAI`. Acá **manda la planilla**, al revés que el resto de Producción | La cuenta de servicio necesita **Editor** para que el alta desde la app escriba la fila. Con lectura sola, cada movimiento queda con `sheets_pendiente` |
| `GOOGLE_SHEETS_ENVASES_TAB` | La pestaña del catálogo | `Listado articulos GRAL`. Su columna de stock es una fórmula: por eso el SdG la lee en vez de calcularla |
| `GOOGLE_SHEETS_ENVASES_TAB_MOV` | La pestaña del kardex | `Entradas  Salidas` — **con doble espacio** |
| `GOOGLE_SHEETS_ENVASES_TAB_PROV` | Los proveedores de envases | `PROVEEDORES` |
| `GOOGLE_SHEETS_ENVASES_TAB_REF` | El color de bolsón y de quién es | `REFERENCIAS` |

- [ ] **Paso 3: La documentación del módulo**

Agregar a `docs/PRODUCCION.md` una sección **"Envases: acá manda la planilla"**,
con el link al spec y esta advertencia, que es la que no se deduce del código:

> Producción es la excepción del sistema —acá manda el SdG y la planilla es una
> exportación de una vía—. **Envases no sigue esa excepción**: su planilla es la
> del almacén clonada y se comporta como Inventario. Las dos direcciones
> conviven en el mismo módulo, así que antes de tocar una ruta conviene saber en
> cuál de las dos está.

En `CLAUDE.md`, la sección "Las planillas de Google" dice hoy que Producción es
la excepción donde manda el sistema. Agregarle:

> …con una excepción adentro: **la sección Envases de Producción espeja una
> planilla donde manda la planilla**, como Compras, Mantenimiento e Inventario.
> Ver [docs/PRODUCCION.md](docs/PRODUCCION.md).

- [ ] **Paso 4: Verificar todo**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

`npm run build` **con `npm run dev` levantado deja la app en 500**: parar el dev
server antes. Y `npm run lint` falla porque el repo no tiene config de ESLint —
no es tu cambio.

- [ ] **Paso 5: Commitear y pushear**

```bash
git commit --only lib/core/nav.ts components/Sidebar.tsx docs/VARIABLES-VERCEL.md docs/PRODUCCION.md CLAUDE.md -m "feat(produccion): envases en el menu, y la excepcion documentada

Produccion es la excepcion del sistema —alla manda el SdG— y Envases es una
excepcion adentro de esa: manda la planilla. Las dos direcciones conviven en el
mismo modulo, asi que queda escrito en CLAUDE.md y en PRODUCCION.md antes de que
alguien toque una ruta suponiendo la direccion equivocada.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Antes de dar la tarea por buena**, el chequeo que los otros tres no pueden
hacer — mira el árbol de git, no el disco:

```bash
node scripts/revisar-arbol-commiteado.mjs HEAD
```

Esperado: `Todos los imports resuelven dentro del árbol commiteado.`

Si dice que falta un archivo, quedó *staged* y nunca se commiteó: agregarlo con
su propio `git commit --only`. Eso tiró cuatro deploys seguidos el 14/09/2026.

Y recién entonces:

```bash
git push origin HEAD:main
```

---

## Lo que queda afuera, y por qué

- **La rotura no descuenta stock.** Está decidido así. Los cuatro números quedan
  crudos, así que el día que se decida lo contrario es una consulta.
- **`CONSULTA` no se espeja.** Es basura heredada del almacén.
- **El artículo no se da de alta desde el SdG.** La planilla manda: un artículo
  nuevo se carga allá y aparece en la próxima sincronización. Un ABM acá abriría
  la puerta a un código que la planilla no conoce, y ese artículo tendría stock
  cero para siempre — su stock es una fórmula que vive allá.
- **No hay cron.** Se trae con el botón, como en Inventario al principio. Si
  resulta que hace falta, es una entrada en `vercel.json` apuntando a la ruta de
  sync, que ya existe y ya funciona sin sesión.
