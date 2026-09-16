# Módulo Calidad — stock de carbonilla — plan de implementación

> **Para quien lo ejecute:** usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans`, tarea por tarea. Los pasos usan `- [ ]` para poder tacharlos.

**Objetivo:** que el stock de carbonilla deje de transcribirse a mano en una planilla. La entrada la pone el sistema —leída de la orden de compra de Odoo o de la balanza del SdG— y Calidad carga sólo lo que es suyo: el consumo del día, el conteo físico y el ajuste.

**Arquitectura:** un libro de movimientos con el signo guardado, así el saldo es `SUM(toneladas)` y no se puede calcular mal. La entrada llega por dos caminos que no se pisan porque comparten una clave: la línea de la orden de compra de Odoo. Toda la aritmética vive en `lib/calidad/` como funciones puras con tests; las rutas traen datos, llaman y exportan.

**Diseño acordado:** [`docs/superpowers/specs/2026-09-16-calidad-stock-de-carbonilla-design.md`](../specs/2026-09-16-calidad-stock-de-carbonilla-design.md). **Leerlo antes de empezar** — tiene las mediciones que explican cada decisión de acá.

**Stack:** Next.js 16 (App Router) · Supabase (Postgres + RLS) · vitest · Odoo por JSON-RPC vía `lib/odoo/client.ts` · Google Sheets vía `lib/core/sheets.ts`.

**Verificación en cada tarea:**

```bash
npm test
npx tsc --noEmit
```

`npm run lint` **falla** en este repo (no hay config de ESLint) — no es tu cambio. `npm run build` **no** se corre con `npm run dev` levantado: deja la app en 500. Antes de dar por buena la última tarea, `node scripts/revisar-arbol-commiteado.mjs`.

**Nunca `git add -A`.** Puede haber otra sesión en el mismo árbol. Agregá por nombre los archivos de la tarea, que están listados en cada una.

**Las migraciones las corre una persona** a mano en el editor SQL de Supabase. Vos escribís el archivo y avisás; no hay CLI. Las tareas 4 en adelante **no se pueden probar contra la base** hasta que las dos migraciones de la tarea 1 estén aplicadas, pero sus tests sí corren: son funciones puras.

---

## Mapa de archivos

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/<ts>_calidad_enum_del_modulo.sql` | El valor `'calidad'` del enum `modulo`. **Viaja solo** |
| `supabase/migrations/<ts>_calidad_schema.sql` | Los tres enums del módulo, las cinco tablas, índices, permisos y RLS |
| `lib/core/types.ts` | Sumar `"calidad"` al tipo `Modulo` |
| `lib/core/access.ts` | Sumar `"calidad"` a `MODULOS_ORDEN` |
| `lib/core/sheets.ts` | Ensanchar `escribirCeldas()` a `string \| number` |
| `lib/core/nav.ts` | El grupo de navegación. **Se toca en la tarea 19**, no antes: un `admin_sistema` ve el menú apenas se agrega, y hasta entonces sus rutas son 404 |
| `lib/calidad/types.ts` | Los tipos del módulo. Sin lógica |
| `lib/calidad/movimientos.ts` | El signo, los saldos y el saldo corrido. El corazón del módulo |
| `lib/calidad/conteos.ts` | El desvío del conteo y el ajuste que propone |
| `lib/calidad/reconocer.ts` | De una línea de Odoo a un movimiento, o a la bandeja |
| `lib/calidad/planilla.ts` | Las diez celdas de una fila. Sin red |
| `lib/calidad/importar.ts` | De un renglón de la planilla vieja a un movimiento. Sin red |
| `lib/calidad/auth.ts` | Los tres niveles, espejando las funciones de la base |
| `lib/calidad/consultas.ts` | Traer catálogos, movimientos y saldos |
| `lib/calidad/sincronizar.ts` | La corrida contra Odoo. Fino: lee, llama a `reconocer.ts`, escribe |
| `lib/calidad/espejo.ts` | La escritura a Google. Fino: arma con `planilla.ts`, escribe |
| `app/api/calidad/movimientos/route.ts` | Alta y corrección de movimientos |
| `app/api/calidad/conteos/route.ts` | El conteo y su ajuste, en una transacción lógica |
| `app/api/calidad/carbonilleros/route.ts` | ABM del catálogo, sólo admin |
| `app/api/calidad/productos/route.ts` | La lista blanca, sólo admin |
| `app/api/calidad/sincronizar/route.ts` | El botón **Sincronizar ahora** |
| `app/api/cron/calidad-sync/route.ts` | La corrida diaria |
| `app/(app)/calidad/**` | Las cuatro pantallas |
| `scripts/importar-stock-carbonilla.mts` | La importación de los veinte meses. Corre una vez |
| `docs/CALIDAD.md` | El documento del módulo |

**Del núcleo se usa y no se reescribe:** `traerTodo()` (`lib/core/paginado.ts`), `hoyEnArgentina()` y `sumarDias()` (`lib/core/fechas.ts`), `fechaDeSheets()` y `serialDelDia()` (`lib/core/fechaDeSheets.ts`), `leerValores()`, `escribirCeldas()` y `agregarFila()` (`lib/core/sheets.ts`), `cuerpoJson()` (`lib/core/cuerpo.ts`), `nivelEnModulo()` (`lib/core/access.ts`), `buscarLeer()` (`lib/odoo/client.ts`), `registrarSincronizacion()` (`lib/core/sincronizaciones.ts`), `revisarElSecreto()` (`lib/core/cron.ts`).

---

# Parte 1 — Cimientos

## Tarea 1: Las dos migraciones

**Archivos:**
- Crear: `supabase/migrations/<timestamp>_calidad_enum_del_modulo.sql`
- Crear: `supabase/migrations/<timestamp>_calidad_schema.sql`

Los nombres se generan con `npm run migracion "..."`, que pone la marca de tiempo. **No inventes el número a mano**: dos sesiones toman el mismo "próximo libre" y chocan.

- [ ] **Paso 1: Generar los dos archivos**

```bash
npm run migracion "calidad enum del modulo"
npm run migracion "calidad schema"
```

- [ ] **Paso 2: Escribir el primero, que lleva una sola línea**

En `<ts>_calidad_enum_del_modulo.sql`:

```sql
-- ============================================================
-- SdG — El módulo Calidad entra al enum
--
-- Viaja solo y no hace nada más. Un valor nuevo de enum no se puede usar en la
-- misma transacción en que se agrega: Postgres devuelve 55P04 ("unsafe use of
-- new value of enum type"). Cualquier función o policy que mencione 'calidad'
-- —incluso en el cuerpo, que se valida al crearla— tiene que ir en un archivo
-- posterior, ya commiteado y corrido éste.
--
-- Es la trampa #1 del README de migraciones, y ya mordió dos veces.
-- Precedentes: 015 (compras), 045 (inventario), 20260907154332 (producción),
-- 20260908104728 (despacho).
-- ============================================================

alter type modulo add value if not exists 'calidad';
```

- [ ] **Paso 3: Escribir el schema**

En `<ts>_calidad_schema.sql`:

```sql
-- ============================================================
-- SdG — Calidad: tablas, permisos y RLS
--
-- Requiere que la migración del enum ya haya corrido y commiteado.
--
-- Reemplaza la planilla de stock de carbonilla (1m9DwAcP…), donde hoy Calidad
-- transcribe a mano lo que Despacho ya transcribió a la planilla de recepción
-- y que ya estaba en Odoo. Ver
-- docs/superpowers/specs/2026-09-16-calidad-stock-de-carbonilla-design.md.
--
-- EL SIGNO VA GUARDADO, NO DESPEJADO. `toneladas` es siempre el efecto sobre el
-- saldo: entrada +, consumo −, ajuste ±. Con eso el saldo es SUM(toneladas) y
-- no hay consulta que pueda calcularlo mal. Los CHECK de abajo son el espejo
-- exacto de `efectoEnElSaldo()` en lib/calidad/movimientos.ts.
--
-- LOS SALDOS NO SE GUARDAN: se despejan al leer. En la planilla vieja eran
-- fórmulas por fila que alguien ya pisó a mano al menos una vez (02/05/2026,
-- +232,5 t), y ése es exactamente el modo de fallar de un derivado guardado.
-- ============================================================

-- ── 1. Los tipos ─────────────────────────────────────────────
-- Van en este archivo y no aparte: 55P04 es sólo para AGREGAR un valor a un
-- enum que ya existe. Estos se crean enteros.

create type calidad_movimiento_tipo as enum ('entrada', 'consumo', 'ajuste');

-- 'sin_separar' es HISTORIA, NO SALDO. El libro viejo no distinguía vegetal de
-- residual hasta el 15/12/2025, y marcar esos once meses como vegetal sería
-- inventar: en esa época Membranex entró más de veinte veces con carbón
-- residual. Como no es ninguno de los dos tipos, no cae en ninguna suma de
-- saldo — no porque alguien se acuerde de excluirlo, sino por construcción.
create type calidad_tipo_carbon as enum ('vegetal', 'residual', 'sin_separar');

create type calidad_origen as enum ('odoo', 'recepcion', 'manual', 'importacion');

-- ── 2. Permisos ──────────────────────────────────────────────
-- Calcadas de las de Despacho (20260908104729). Tienen que decir lo mismo que
-- lib/calidad/auth.ts: cuando no coincidieron, en la 029, un admin_sistema veía
-- los botones y RLS le devolvía listas vacías.

create or replace function public.tiene_acceso_calidad()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid() and modulo = 'calidad'
    ),
    false
  )
$$;

create or replace function public.puede_editar_calidad()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid() and modulo = 'calidad'
        and nivel in ('edicion', 'admin')
    ),
    false
  )
$$;

create or replace function public.es_admin_calidad()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid() and modulo = 'calidad' and nivel = 'admin'
    ),
    false
  )
$$;

-- ── 3. Los carbonilleros ─────────────────────────────────────
-- SE IDENTIFICAN POR EL PARTNER DE ODOO, y el proveedor del núcleo es opcional.
-- No es rehacer el catálogo del núcleo desde un módulo: acá no hay razón social
-- ni CUIT ni domicilio, hay tipo de carbón y nombre de planilla, que son
-- configuración de Calidad. Se identifica por lo que el dato realmente trae: la
-- línea de compra llega con un partner_id. Exigir que exista primero en
-- `proveedores` con CUIT vinculado pondría entre el camión y el stock una tarea
-- que hace un mes no se hace: al 16/09/2026, seis de los diez carbonilleros no
-- tienen CUIT cargado, y LA INVENCIBLE —cinco camiones en septiembre— no existe
-- en el catálogo. Eso ya tiene parado al módulo de recepción de Despacho.

create table public.calidad_carbonilleros (
  id                  uuid primary key default gen_random_uuid(),
  odoo_partner_id     integer not null,
  empresa_id          uuid not null references public.empresas(id),
  proveedor_id        uuid references public.proveedores(id),
  carbon              calidad_tipo_carbon not null,
  nombre_planilla     text not null,
  codigo_planilla     text not null,
  activo              boolean not null default true,
  cargado_por         uuid references public.usuarios(id),
  cargado_en          timestamptz not null default now(),
  actualizado_por     uuid references public.usuarios(id),
  actualizado_en      timestamptz,

  -- El vínculo con Odoo es POR EMPRESA, como en proveedores_odoo.
  constraint calidad_carbonilleros_unico unique (odoo_partner_id, empresa_id),
  -- Un carbonillero de hoy nunca puede ser 'sin_separar': ese valor es de la
  -- historia importada y de nada más.
  constraint calidad_carbonilleros_carbon_real check (carbon <> 'sin_separar')
);

-- ── 4. La lista blanca de productos ──────────────────────────
-- SE ELIGE POR ID Y NUNCA POR NOMBRE: en esta base conviven `CARBONILLA`
-- (6909) y `CARBONILLA ` (4419) con un espacio al final, los dos buenos, con
-- 947 líneas entre ambos. Al lado hay `Flete carbonilla`, `Flete de Carbonilla`,
-- `Carbonilla (Archivado)`, `Carbonillia` y `97000kl de carbonilla`.
--
-- `cuenta = false` no es lo mismo que no estar: es "ya lo miré, es flete, no me
-- lo muestres más en la bandeja".

create table public.calidad_productos_odoo (
  odoo_product_id     integer primary key,
  odoo_product_nombre text not null,
  cuenta              boolean not null,
  cargado_por         uuid references public.usuarios(id),
  cargado_en          timestamptz not null default now()
);

-- ── 5. El libro ──────────────────────────────────────────────

create table public.calidad_movimientos (
  id                      uuid primary key default gen_random_uuid(),
  fecha                   date not null,
  tipo                    calidad_movimiento_tipo not null,
  carbon                  calidad_tipo_carbon not null,
  -- CON SIGNO: es el efecto sobre el saldo, no una magnitud.
  toneladas               numeric(12,3) not null,
  motivo                  text,
  carbonillero_id         uuid references public.calidad_carbonilleros(id),
  proveedor_id            uuid references public.proveedores(id),
  origen                  calidad_origen not null,
  odoo_purchase_line_id   integer,
  odoo_purchase_name      text,
  despacho_recepcion_id   uuid references public.despacho_recepciones(id),
  sheets_fila             integer,
  sheets_pendiente        text,
  sheets_pendiente_en     timestamptz,
  cargado_por             uuid references public.usuarios(id),
  cargado_en              timestamptz not null default now(),
  actualizado_por         uuid references public.usuarios(id),
  actualizado_en          timestamptz,

  constraint calidad_mov_signo check (
    (tipo = 'entrada' and toneladas > 0) or
    (tipo = 'consumo' and toneladas < 0) or
    (tipo = 'ajuste'  and toneladas <> 0)
  ),
  -- El ajuste SIEMPRE lleva motivo escrito, y los otros dos nunca. Hoy el
  -- ajuste se disfraza de consumo y la explicación va en la columna del conteo
  -- físico: el 20/04/2026 hay un "CONSUMO VEGETAL 46" que en realidad decía
  -- "AJUSTE DE STOCK (-46 Tn.)". Un CHECK, no una costumbre.
  constraint calidad_mov_motivo check (
    (tipo =  'ajuste' and motivo is not null and btrim(motivo) <> '') or
    (tipo <> 'ajuste' and motivo is null)
  ),
  constraint calidad_mov_carbonillero check (
    (tipo =  'entrada' and carbonillero_id is not null) or
    (tipo <> 'entrada' and carbonillero_id is null)
  ),
  -- La contención de 'sin_separar': no puede filtrarse a datos nuevos.
  constraint calidad_mov_sin_separar check (
    carbon <> 'sin_separar' or fecha < date '2025-12-15'
  )
);

-- ÍNDICE UNIQUE COMPLETO, NO PARCIAL: es el destino de un ON CONFLICT, y un
-- índice parcial ahí no sirve (trampa del README de migraciones). Los NULL de
-- los consumos y los ajustes no chocan entre sí, así que no hace falta el WHERE.
--
-- Y la clave es LA LÍNEA, no la orden: 7 de las 577 órdenes de carbonilla del
-- año tienen dos líneas —la segunda es FLETE—, así que la orden no identifica
-- un camión y la línea sí.
create unique index calidad_mov_odoo_line on public.calidad_movimientos (odoo_purchase_line_id);
create unique index calidad_mov_recepcion on public.calidad_movimientos (despacho_recepcion_id);
create index calidad_mov_fecha on public.calidad_movimientos (fecha);
create index calidad_mov_carbon_fecha on public.calidad_movimientos (carbon, fecha);

-- ── 6. Los conteos físicos ───────────────────────────────────
-- `teorico_al_contar` SE GUARDA A PROPÓSITO, y no contradice la regla de no
-- guardar derivados: no es el saldo de hoy, es el que el sistema decía ESE DÍA.
-- Si después se corrige un movimiento viejo —y se van a corregir— el teórico de
-- entonces cambia, y el desvío que una persona miró y explicó dejaría de poder
-- reconstruirse. En veinte meses hubo 34 conteos con desvíos de −247 a +148 t.

create table public.calidad_conteos (
  id                  uuid primary key default gen_random_uuid(),
  fecha               date not null,
  carbon              calidad_tipo_carbon not null,
  toneladas_contadas  numeric(12,3) not null,
  teorico_al_contar   numeric(12,3) not null,
  ajuste_id           uuid references public.calidad_movimientos(id),
  notas               text,
  cargado_por         uuid references public.usuarios(id),
  cargado_en          timestamptz not null default now(),

  constraint calidad_conteos_carbon_real check (carbon <> 'sin_separar')
);

create index calidad_conteos_fecha on public.calidad_conteos (fecha);

-- ── 7. La bandeja ────────────────────────────────────────────
-- Lo que la sincronización no pudo convertir en movimiento, con el motivo
-- escrito. Son unas cuatro por año, pero es una tabla y no un cálculo al vuelo
-- para que la pantalla no dependa de que Odoo conteste.

create table public.calidad_odoo_sin_reconocer (
  odoo_purchase_line_id integer primary key,
  odoo_purchase_name    text not null,
  odoo_partner_id       integer not null,
  odoo_partner_nombre   text not null,
  odoo_product_id       integer not null,
  odoo_product_nombre   text not null,
  fecha                 date not null,
  toneladas             numeric(12,3) not null,
  motivo                text not null,
  visto_en              timestamptz not null default now()
);

-- ── 8. RLS ───────────────────────────────────────────────────

alter table public.calidad_carbonilleros       enable row level security;
alter table public.calidad_productos_odoo      enable row level security;
alter table public.calidad_movimientos         enable row level security;
alter table public.calidad_conteos             enable row level security;
alter table public.calidad_odoo_sin_reconocer  enable row level security;

create policy calidad_carbonilleros_leer on public.calidad_carbonilleros
  for select using (tiene_acceso_calidad());
create policy calidad_carbonilleros_escribir on public.calidad_carbonilleros
  for all using (es_admin_calidad()) with check (es_admin_calidad());

create policy calidad_productos_leer on public.calidad_productos_odoo
  for select using (tiene_acceso_calidad());
create policy calidad_productos_escribir on public.calidad_productos_odoo
  for all using (es_admin_calidad()) with check (es_admin_calidad());

create policy calidad_mov_leer on public.calidad_movimientos
  for select using (tiene_acceso_calidad());
create policy calidad_mov_escribir on public.calidad_movimientos
  for all using (puede_editar_calidad()) with check (puede_editar_calidad());

create policy calidad_conteos_leer on public.calidad_conteos
  for select using (tiene_acceso_calidad());
create policy calidad_conteos_escribir on public.calidad_conteos
  for all using (puede_editar_calidad()) with check (puede_editar_calidad());

create policy calidad_bandeja_leer on public.calidad_odoo_sin_reconocer
  for select using (tiene_acceso_calidad());
create policy calidad_bandeja_escribir on public.calidad_odoo_sin_reconocer
  for all using (puede_editar_calidad()) with check (puede_editar_calidad());
```

- [ ] **Paso 4: Commitear y avisar**

```bash
git add supabase/migrations/<ts>_calidad_enum_del_modulo.sql supabase/migrations/<ts>_calidad_schema.sql
git commit -m "feat(calidad): las dos migraciones del modulo"
```

Decíle al usuario que corra **primero** el del enum, lo confirme, y **después** el schema. Si los corre juntos, el schema falla con `55P04` porque sus policies mencionan `'calidad'`. **Quedate a la espera**: las tareas que tocan la base no se pueden probar hasta que estén aplicadas.

---

## Tarea 2: El módulo entra al núcleo

**Archivos:**
- Modificar: `lib/core/types.ts:11`
- Modificar: `lib/core/access.ts:4`
- Test: `lib/core/access.test.ts` (si existe; si no, no se crea uno para esto)

**No se toca `lib/core/nav.ts` todavía.** Un `admin_sistema` ve el menú apenas se agrega el grupo, y hasta la tarea 19 sus rutas son 404.

- [ ] **Paso 1: Sumar el módulo al tipo**

En `lib/core/types.ts`, línea 11:

```ts
export type Modulo = "rrhh" | "mantenimiento" | "remises" | "compras" | "inventario" | "produccion" | "despacho" | "facturacion" | "cantera" | "calidad";
```

- [ ] **Paso 2: Sumarlo al orden canónico**

En `lib/core/access.ts`, línea 4. Va **al final**, que es el orden en que se fueron construyendo:

```ts
export const MODULOS_ORDEN: Modulo[] = ["rrhh", "mantenimiento", "remises", "compras", "inventario", "produccion", "despacho", "facturacion", "cantera", "calidad"];
```

- [ ] **Paso 3: Verificar**

```bash
npx tsc --noEmit
npm test
```

Esperado: ambos en verde. Si `tsc` se queja de un `switch` sin caso para `"calidad"` en algún archivo que no tocaste, **mirá `git status` antes de arreglarlo**: puede ser un refactor en curso de otra sesión.

- [ ] **Paso 4: Commitear**

```bash
git add lib/core/types.ts lib/core/access.ts
git commit -m "feat(calidad): el modulo entra al nucleo"
```

---

## Tarea 3: Los tipos y los permisos del módulo

**Archivos:**
- Crear: `lib/calidad/types.ts`
- Crear: `lib/calidad/auth.ts`

- [ ] **Paso 1: Escribir los tipos**

`lib/calidad/types.ts`:

```ts
/** Los tipos del módulo Calidad. Sin lógica: la lógica vive en los otros archivos. */

export type TipoDeMovimiento = "entrada" | "consumo" | "ajuste";

/**
 * `sin_separar` es historia, no saldo.
 *
 * El libro viejo no distinguía vegetal de residual hasta el 15/12/2025. Los
 * movimientos anteriores se importan con este valor y **no caen en ninguna suma
 * de saldo**, porque no son ninguno de los dos tipos. Un CHECK en la base le
 * prohíbe fechas posteriores al corte.
 */
export type TipoDeCarbon = "vegetal" | "residual" | "sin_separar";

/** Los dos que existen hoy. Es lo que se puede cargar y lo que tiene saldo. */
export type CarbonReal = Exclude<TipoDeCarbon, "sin_separar">;

export type OrigenDelMovimiento = "odoo" | "recepcion" | "manual" | "importacion";

export interface Movimiento {
  id: string;
  fecha: string;
  tipo: TipoDeMovimiento;
  carbon: TipoDeCarbon;
  /** Con signo: el efecto sobre el saldo. */
  toneladas: number;
  motivo: string | null;
  carbonillero_id: string | null;
  proveedor_id: string | null;
  origen: OrigenDelMovimiento;
  odoo_purchase_line_id: number | null;
  odoo_purchase_name: string | null;
  despacho_recepcion_id: string | null;
  sheets_fila: number | null;
  sheets_pendiente: string | null;
  sheets_pendiente_en: string | null;
  cargado_por: string | null;
  cargado_en: string;
  actualizado_por: string | null;
  actualizado_en: string | null;
}

export interface Carbonillero {
  id: string;
  odoo_partner_id: number;
  empresa_id: string;
  proveedor_id: string | null;
  carbon: CarbonReal;
  nombre_planilla: string;
  codigo_planilla: string;
  activo: boolean;
}

export interface ProductoDeOdoo {
  odoo_product_id: number;
  odoo_product_nombre: string;
  cuenta: boolean;
}

export interface Conteo {
  id: string;
  fecha: string;
  carbon: CarbonReal;
  toneladas_contadas: number;
  teorico_al_contar: number;
  ajuste_id: string | null;
  notas: string | null;
  cargado_por: string | null;
  cargado_en: string;
}

export interface LineaSinReconocer {
  odoo_purchase_line_id: number;
  odoo_purchase_name: string;
  odoo_partner_id: number;
  odoo_partner_nombre: string;
  odoo_product_id: number;
  odoo_product_nombre: string;
  fecha: string;
  toneladas: number;
  motivo: string;
  visto_en: string;
}
```

- [ ] **Paso 2: Escribir los permisos, calcados de Despacho**

`lib/calidad/auth.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { nivelEnModulo } from "@/lib/core/access";
import type { Rol, UsuarioModulo } from "@/lib/core/types";

/**
 * Permisos del módulo Calidad.
 *
 *   lectura  ve el stock y el libro
 *   edicion  además carga consumos, conteos, ajustes y entradas a mano
 *   admin    además edita los carbonilleros y la lista blanca de productos
 *
 * En la base los espejan `tiene_acceso_calidad()`, `puede_editar_calidad()` y
 * `es_admin_calidad()`. Las dos mitades tienen que decir lo mismo: es lo que la
 * 029 tuvo que corregir en Mantenimiento cuando un `admin_sistema` veía los
 * botones y RLS le devolvía listas vacías.
 */

export async function nivelCalidadDe(
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

  return nivelEnModulo(usuario.rol as Rol, (grants ?? []) as UsuarioModulo[], "calidad");
}

/** Acceso al módulo, con cualquier nivel. Hace falta donde se usa el cliente admin: ahí RLS no corre. */
export async function tieneAccesoCalidad(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  return (await nivelCalidadDe(supabase, userId)) !== null;
}

/** Cargar consumos, conteos, ajustes y entradas a mano. */
export async function puedeEditarCalidad(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const nivel = await nivelCalidadDe(supabase, userId);
  return nivel === "edicion" || nivel === "admin";
}

/** Editar los carbonilleros y la lista blanca de productos. */
export async function esAdminCalidad(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  return (await nivelCalidadDe(supabase, userId)) === "admin";
}
```

- [ ] **Paso 3: Verificar y commitear**

```bash
npx tsc --noEmit
git add lib/calidad/types.ts lib/calidad/auth.ts
git commit -m "feat(calidad): los tipos y los tres niveles de permiso"
```

---

# Parte 2 — La aritmética

Todo lo de esta parte son **funciones puras con tests**, que es donde están las decisiones. No hablan con Supabase, ni con Odoo, ni con Google.

## Tarea 4: El signo

**Archivos:**
- Crear: `lib/calidad/movimientos.ts`
- Test: `lib/calidad/movimientos.test.ts`

- [ ] **Paso 1: Escribir el test que falla**

`lib/calidad/movimientos.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { efectoEnElSaldo } from "./movimientos";

describe("efectoEnElSaldo", () => {
  it("una entrada suma", () => {
    expect(efectoEnElSaldo("entrada", 19.58)).toEqual({ toneladas: 19.58, problema: null });
  });

  it("un consumo se carga en positivo y se guarda en negativo", () => {
    expect(efectoEnElSaldo("consumo", 37)).toEqual({ toneladas: -37, problema: null });
  });

  it("un ajuste guarda el signo que se tipeó, en menos", () => {
    // El 20/04/2026 se cargó como "CONSUMO VEGETAL 46" con la nota
    // "AJUSTE DE STOCK (-46 Tn.)". Acá es un ajuste y se ve.
    expect(efectoEnElSaldo("ajuste", -46)).toEqual({ toneladas: -46, problema: null });
  });

  it("un ajuste guarda el signo que se tipeó, en más", () => {
    // El 02/05/2026 el ajuste en más no tuvo dónde entrar y alguien pisó la
    // fórmula del saldo a mano.
    expect(efectoEnElSaldo("ajuste", 232.5)).toEqual({ toneladas: 232.5, problema: null });
  });

  it("una entrada en cero o negativa es un error de carga", () => {
    expect(efectoEnElSaldo("entrada", 0).problema).toBeTruthy();
    expect(efectoEnElSaldo("entrada", -5).problema).toBeTruthy();
  });

  it("un consumo en negativo es un error de carga, no un ajuste encubierto", () => {
    expect(efectoEnElSaldo("consumo", -5).problema).toBeTruthy();
    expect(efectoEnElSaldo("consumo", 0).problema).toBeTruthy();
  });

  it("un ajuste de cero no es un ajuste", () => {
    expect(efectoEnElSaldo("ajuste", 0).problema).toBeTruthy();
  });

  it("lo que no es número se rechaza y no se convierte en NaN", () => {
    expect(efectoEnElSaldo("consumo", NaN).problema).toBeTruthy();
    expect(efectoEnElSaldo("consumo", Infinity).problema).toBeTruthy();
  });

  it("redondea a tres decimales, que es lo que guarda la base", () => {
    expect(efectoEnElSaldo("entrada", 19.5789).toneladas).toBe(19.579);
  });
});
```

- [ ] **Paso 2: Correrlo y verificar que falla**

```bash
npx vitest run lib/calidad/movimientos.test.ts
```

Esperado: FAIL, `Failed to resolve import "./movimientos"`.

- [ ] **Paso 3: Escribir la implementación mínima**

`lib/calidad/movimientos.ts`:

```ts
import type { TipoDeMovimiento } from "./types";

/**
 * El día desde el cual el libro distingue vegetal de residual.
 *
 * Antes de esta fecha las columnas `VEGETAL` y `RESIDUAL` de la planilla están
 * vacías: había un solo saldo. Los movimientos importados de antes llevan
 * `carbon = 'sin_separar'`, y un CHECK en la base impide que ese valor aparezca
 * con fecha posterior.
 */
export const CORTE_DE_LOS_TIPOS = "2025-12-15";

/** Tres decimales, que es `numeric(12,3)` en la base. */
function aTresDecimales(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export interface EfectoEnElSaldo {
  /** Con signo: exactamente lo que va a la columna `toneladas`. */
  toneladas: number | null;
  problema: string | null;
}

/**
 * De lo que una persona tipea al número con signo que se guarda.
 *
 * **El signo va guardado, no despejado.** Con eso el saldo es `SUM(toneladas)`
 * y no hay consulta que pueda calcularlo mal; la alternativa —guardar todo
 * positivo y aplicar el signo al leer— pone la regla en cada consulta, y la
 * consulta que se olvida es la que nadie mira.
 *
 * Esta función es el espejo exacto del CHECK `calidad_mov_signo`. Si una
 * cambia, la otra también.
 *
 * El consumo **se carga en positivo**: nadie escribe "menos treinta y siete
 * toneladas" cuando anota lo que se quemó. El ajuste sí se carga con su signo,
 * porque puede ser en más o en menos y esa es toda su gracia.
 */
export function efectoEnElSaldo(tipo: TipoDeMovimiento, tipeado: number): EfectoEnElSaldo {
  if (!Number.isFinite(tipeado)) {
    return { toneladas: null, problema: "Las toneladas tienen que ser un número." };
  }

  const n = aTresDecimales(tipeado);

  if (tipo === "entrada") {
    return n > 0
      ? { toneladas: n, problema: null }
      : { toneladas: null, problema: "Una entrada tiene que ser mayor que cero." };
  }

  if (tipo === "consumo") {
    return n > 0
      ? { toneladas: -n, problema: null }
      : {
          toneladas: null,
          problema:
            "El consumo se carga en positivo: es lo que se quemó. Si querés sumar stock, es un ajuste.",
        };
  }

  return n !== 0
    ? { toneladas: n, problema: null }
    : { toneladas: null, problema: "Un ajuste de cero no cambia nada." };
}
```

- [ ] **Paso 4: Correr y verificar que pasa**

```bash
npx vitest run lib/calidad/movimientos.test.ts
```

Esperado: 9 tests en verde.

- [ ] **Paso 5: Commitear**

```bash
git add lib/calidad/movimientos.ts lib/calidad/movimientos.test.ts
git commit -m "feat(calidad): el signo del movimiento, espejo del CHECK de la base"
```

---

## Tarea 5: Los saldos y el saldo corrido

**Archivos:**
- Modificar: `lib/calidad/movimientos.ts`
- Test: `lib/calidad/movimientos.test.ts`

- [ ] **Paso 1: Agregar los tests que fallan**

Al final de `lib/calidad/movimientos.test.ts`:

```ts
import { saldosDelLibro, saldoCorrido } from "./movimientos";

const mov = (carbon: string, toneladas: number, fecha = "2026-01-01", cargado_en = "2026-01-01T10:00:00Z") =>
  ({ carbon, toneladas, fecha, cargado_en }) as never;

describe("saldosDelLibro", () => {
  it("suma por tipo y despeja el total", () => {
    expect(
      saldosDelLibro([mov("vegetal", 20), mov("vegetal", -15), mov("residual", 25)])
    ).toEqual({ vegetal: 5, residual: 25, total: 30 });
  });

  it("los sin_separar no caen en ningún saldo", () => {
    // Los once meses importados de antes del 15/12/2025 suman un número enorme
    // y negativo —siete de esos meses son consumo sin un solo camión— y no son
    // el stock de nada.
    expect(
      saldosDelLibro([mov("vegetal", 100), mov("sin_separar", -5000)])
    ).toEqual({ vegetal: 100, residual: 0, total: 100 });
  });

  it("un saldo negativo se ve y no se corrige solo", () => {
    // El residual llegó a −0,47 el 19/08/2026 y era real.
    expect(saldosDelLibro([mov("residual", 10), mov("residual", -10.47)]).residual).toBe(-0.47);
  });

  it("no arrastra ruido de coma flotante", () => {
    // La planilla vieja mostraba 355.8569999999998 por acumular en la celda.
    expect(saldosDelLibro([mov("vegetal", 0.1), mov("vegetal", 0.2)]).vegetal).toBe(0.3);
  });

  it("un libro vacío es cero y no es un error", () => {
    expect(saldosDelLibro([])).toEqual({ vegetal: 0, residual: 0, total: 0 });
  });
});

describe("saldoCorrido", () => {
  it("devuelve cada movimiento con el saldo después de él, por fecha y luego por carga", () => {
    const filas = saldoCorrido([
      mov("vegetal", -10, "2026-01-02", "2026-01-02T18:00:00Z"),
      mov("vegetal", 20, "2026-01-01", "2026-01-01T09:00:00Z"),
      mov("residual", 5, "2026-01-02", "2026-01-02T08:00:00Z"),
    ]);
    expect(filas.map((f) => [f.fecha, f.saldoVegetal, f.saldoResidual, f.saldoTotal])).toEqual([
      ["2026-01-01", 20, 0, 20],
      ["2026-01-02", 20, 5, 25],
      ["2026-01-02", 10, 5, 15],
    ]);
  });

  it("los sin_separar no mueven los dos saldos", () => {
    const filas = saldoCorrido([mov("sin_separar", -40, "2025-06-01"), mov("vegetal", 8, "2026-01-01")]);
    expect(filas.map((f) => f.saldoTotal)).toEqual([0, 8]);
  });
});
```

- [ ] **Paso 2: Correr y verificar que falla**

```bash
npx vitest run lib/calidad/movimientos.test.ts
```

Esperado: FAIL, `saldosDelLibro is not a function`.

- [ ] **Paso 3: Implementar**

En `lib/calidad/movimientos.ts`, ampliar el import de arriba a
`import type { TipoDeMovimiento, TipoDeCarbon } from "./types";` y agregar al
final del archivo:

```ts
export interface Saldos {
  vegetal: number;
  residual: number;
  /** Despejado, no guardado: es la suma de los otros dos. */
  total: number;
}

/** Lo mínimo que `saldosDelLibro` necesita de un movimiento. */
interface ParaSumar {
  carbon: TipoDeCarbon;
  toneladas: number;
}

/**
 * Los dos saldos, y el total.
 *
 * Es una suma y nada más, y eso es a propósito: el signo ya viene guardado en
 * `toneladas`, así que no hay regla que aplicar acá. En la planilla vieja esto
 * eran fórmulas por fila que acumulaban celda contra celda, y por eso el saldo
 * mostraba `355.8569999999998` — y por eso, cuando el ajuste en más no tuvo
 * dónde entrar, alguien pudo pisar una celda y romper la cadena sin que nada
 * avisara.
 *
 * **Los `sin_separar` no caen acá**, y no porque se los excluya: porque no son
 * ninguno de los dos tipos que se suman.
 */
export function saldosDelLibro(movimientos: ParaSumar[]): Saldos {
  let vegetal = 0;
  let residual = 0;

  for (const m of movimientos) {
    if (m.carbon === "vegetal") vegetal += m.toneladas;
    else if (m.carbon === "residual") residual += m.toneladas;
  }

  vegetal = aTresDecimales(vegetal);
  residual = aTresDecimales(residual);
  return { vegetal, residual, total: aTresDecimales(vegetal + residual) };
}

export interface ConSaldo<T> {
  movimiento: T;
  fecha: string;
  saldoVegetal: number;
  saldoResidual: number;
  saldoTotal: number;
}

/**
 * Cada movimiento con el saldo que queda **después** de él.
 *
 * Ordena por fecha y, dentro del día, por el orden en que se cargaron. El saldo
 * que significa algo es **el del cierre de cada día**: inventar un orden
 * intradiario que el circuito real no tiene sería inventar precisión.
 */
export function saldoCorrido<T extends ParaSumar & { fecha: string; cargado_en: string }>(
  movimientos: T[]
): ConSaldo<T>[] {
  const ordenados = [...movimientos].sort(
    (a, b) => a.fecha.localeCompare(b.fecha) || a.cargado_en.localeCompare(b.cargado_en)
  );

  let vegetal = 0;
  let residual = 0;

  return ordenados.map((m) => {
    if (m.carbon === "vegetal") vegetal = aTresDecimales(vegetal + m.toneladas);
    else if (m.carbon === "residual") residual = aTresDecimales(residual + m.toneladas);
    return {
      movimiento: m,
      fecha: m.fecha,
      saldoVegetal: vegetal,
      saldoResidual: residual,
      saldoTotal: aTresDecimales(vegetal + residual),
    };
  });
}
```

- [ ] **Paso 4: Correr y verificar**

```bash
npx vitest run lib/calidad/movimientos.test.ts
```

Esperado: 16 tests en verde.

- [ ] **Paso 5: Commitear**

```bash
git add lib/calidad/movimientos.ts lib/calidad/movimientos.test.ts
git commit -m "feat(calidad): los dos saldos y el saldo corrido, sin ruido de coma flotante"
```

---

## Tarea 6: El conteo físico y el ajuste que propone

**Archivos:**
- Crear: `lib/calidad/conteos.ts`
- Test: `lib/calidad/conteos.test.ts`

- [ ] **Paso 1: Escribir el test que falla**

`lib/calidad/conteos.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { desvioDelConteo } from "./conteos";

describe("desvioDelConteo", () => {
  it("cuando coincide no propone ningún ajuste", () => {
    expect(desvioDelConteo(300, 300)).toEqual({ desvio: 0, hayDesvio: false, ajuste: null });
  });

  it("cuando falta carbón propone un ajuste en menos", () => {
    // El 11/09/2026: teórico 326,857, contado 298.
    const r = desvioDelConteo(298, 326.857);
    expect(r.hayDesvio).toBe(true);
    expect(r.desvio).toBe(-28.857);
    expect(r.ajuste).toEqual({ toneladas: -28.857 });
  });

  it("cuando sobra carbón propone un ajuste en más", () => {
    // El 27/08/2026: desvío +16,063.
    const r = desvioDelConteo(190, 173.937);
    expect(r.desvio).toBe(16.063);
    expect(r.ajuste).toEqual({ toneladas: 16.063 });
  });

  it("el ajuste lleva al saldo exactamente a lo contado", () => {
    const r = desvioDelConteo(298, 326.857);
    expect(326.857 + r.ajuste!.toneladas).toBeCloseTo(298, 3);
  });

  it("un conteo que no es número se rechaza", () => {
    expect(desvioDelConteo(NaN, 300).problema).toBeTruthy();
    expect(desvioDelConteo(300, NaN).problema).toBeTruthy();
  });

  it("un conteo negativo se rechaza: no hay stock físico negativo", () => {
    expect(desvioDelConteo(-5, 300).problema).toBeTruthy();
  });
});
```

- [ ] **Paso 2: Correr y verificar que falla**

```bash
npx vitest run lib/calidad/conteos.test.ts
```

Esperado: FAIL, `Failed to resolve import "./conteos"`.

- [ ] **Paso 3: Implementar**

`lib/calidad/conteos.ts`:

```ts
/**
 * El conteo físico y el ajuste que propone.
 *
 * En veinte meses hubo **34 conteos** con desvíos de −247 a +148 toneladas, y
 * el saldo teórico seguía de largo: el ajuste se cargaba después, a mano y
 * disfrazado de consumo. Acá el conteo propone el ajuste por la diferencia
 * exacta y **alguien lo confirma escribiendo el motivo** — la confirmación es
 * de la ruta, no de esta función.
 */

function aTresDecimales(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export interface DesvioDelConteo {
  /** Contado menos teórico. Negativo es que falta carbón. */
  desvio: number;
  hayDesvio: boolean;
  /** El ajuste que llevaría el saldo a lo contado, o `null` si no hace falta. */
  ajuste: { toneladas: number } | null;
  problema?: string;
}

export function desvioDelConteo(contado: number, teorico: number): DesvioDelConteo {
  const vacio = { desvio: 0, hayDesvio: false, ajuste: null };

  if (!Number.isFinite(contado) || !Number.isFinite(teorico)) {
    return { ...vacio, problema: "El conteo y el teórico tienen que ser números." };
  }
  if (contado < 0) {
    return { ...vacio, problema: "Un conteo físico no puede ser negativo." };
  }

  const desvio = aTresDecimales(contado - teorico);
  return desvio === 0
    ? { desvio: 0, hayDesvio: false, ajuste: null }
    : { desvio, hayDesvio: true, ajuste: { toneladas: desvio } };
}
```

- [ ] **Paso 4: Correr y verificar**

```bash
npx vitest run lib/calidad/conteos.test.ts
```

Esperado: 6 tests en verde.

- [ ] **Paso 5: Commitear**

```bash
git add lib/calidad/conteos.ts lib/calidad/conteos.test.ts
git commit -m "feat(calidad): el conteo fisico propone su ajuste, con el motivo aparte"
```

---

## Tarea 7: De una línea de Odoo a un movimiento

**Archivos:**
- Crear: `lib/calidad/reconocer.ts`
- Test: `lib/calidad/reconocer.test.ts`

Ésta es la función que decide qué entra al stock de la fábrica. Los casos del test son **líneas reales medidas el 15/09/2026**.

- [ ] **Paso 1: Escribir el test que falla**

`lib/calidad/reconocer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { movimientoDesdeLaLineaDeOdoo, type LineaDeOdoo, type Catalogos } from "./reconocer";

const CATALOGOS: Catalogos = {
  carbonilleros: new Map([
    [906, { id: "c-bruzzone", carbon: "vegetal" as const, proveedorId: null }],
    [2527, { id: "c-membranex", carbon: "residual" as const, proveedorId: "p-membranex" }],
    [1030, { id: "c-katherine", carbon: "vegetal" as const, proveedorId: "p-katherine" }],
    [1056, { id: "c-walkimia", carbon: "vegetal" as const, proveedorId: null }],
  ]),
  productos: new Map([
    [4419, true],   // `CARBONILLA ` — con el espacio al final
    [6909, true],   // `CARBONILLA`  — sin el espacio
    [5583, true],   // `Carbonilla de coque`
    [4914, false],  // `Flete carbonilla`
  ]),
};

const linea = (p: Partial<LineaDeOdoo> = {}): LineaDeOdoo => ({
  id: 3087,
  ordenNombre: "P02420",
  fecha: "2026-09-04",
  partnerId: 906,
  partnerNombre: "BRUZZONE JUAN ALBERTO",
  productoId: 4419,
  productoNombre: "CARBONILLA ",
  cantidad: 19.58,
  ...p,
});

describe("movimientoDesdeLaLineaDeOdoo", () => {
  it("una entrada normal entra, con el signo en más", () => {
    const r = movimientoDesdeLaLineaDeOdoo(linea(), CATALOGOS);
    expect(r.resultado).toBe("entra");
    if (r.resultado !== "entra") throw new Error("no entró");
    expect(r.movimiento).toEqual({
      fecha: "2026-09-04",
      tipo: "entrada",
      carbon: "vegetal",
      toneladas: 19.58,
      carbonillero_id: "c-bruzzone",
      proveedor_id: null,
      origen: "odoo",
      odoo_purchase_line_id: 3087,
      odoo_purchase_name: "P02420",
      motivo: null,
    });
  });

  it("EL TIPO SALE DEL PROVEEDOR Y NO DEL PRODUCTO", () => {
    // Membranex, el único residual, usa `CARBONILLA ` 6 veces al año: el mismo
    // producto que todos los vegetales. Deducir el tipo del producto daría
    // residual como vegetal, y el dato aparecería en el saldo que no es.
    const r = movimientoDesdeLaLineaDeOdoo(
      linea({ partnerId: 2527, partnerNombre: "MEMBRANEX S.A.", productoId: 4419 }),
      CATALOGOS
    );
    if (r.resultado !== "entra") throw new Error("no entró");
    expect(r.movimiento.carbon).toBe("residual");
    expect(r.movimiento.proveedor_id).toBe("p-membranex");
  });

  it("un flete se descarta y no molesta en la bandeja", () => {
    const r = movimientoDesdeLaLineaDeOdoo(
      linea({ productoId: 4914, productoNombre: "Flete carbonilla" }),
      CATALOGOS
    );
    expect(r.resultado).toBe("descartado");
  });

  it("un producto que nadie resolvió va a la bandeja", () => {
    const r = movimientoDesdeLaLineaDeOdoo(
      linea({ productoId: 4734, productoNombre: "Carbonillia" }),
      CATALOGOS
    );
    expect(r.resultado).toBe("a_la_bandeja");
    if (r.resultado !== "a_la_bandeja") throw new Error("no fue a la bandeja");
    expect(r.motivo).toContain("Carbonillia");
  });

  it("un proveedor sin declarar va a la bandeja, y eso gana sobre el producto", () => {
    const r = movimientoDesdeLaLineaDeOdoo(
      linea({ partnerId: 876, partnerNombre: "GARELLI JUAN CARLOS", productoId: 4734 }),
      CATALOGOS
    );
    expect(r.resultado).toBe("a_la_bandeja");
    if (r.resultado !== "a_la_bandeja") throw new Error("no fue a la bandeja");
    expect(r.motivo).toContain("GARELLI JUAN CARLOS");
  });

  it("los kilos cargados como toneladas van a la bandeja", () => {
    // La P02304: 38.660 en la línea. Son kilos.
    const r = movimientoDesdeLaLineaDeOdoo(
      linea({ id: 2900, ordenNombre: "P02304", partnerId: 1030, cantidad: 38660 }),
      CATALOGOS
    );
    expect(r.resultado).toBe("a_la_bandeja");
    if (r.resultado !== "a_la_bandeja") throw new Error("no fue a la bandeja");
    expect(r.motivo).toContain("38660");
  });

  it("una línea en cero va a la bandeja", () => {
    // La P02292.
    const r = movimientoDesdeLaLineaDeOdoo(
      linea({ id: 2870, ordenNombre: "P02292", partnerId: 1056, cantidad: 0 }),
      CATALOGOS
    );
    expect(r.resultado).toBe("a_la_bandeja");
  });

  it("redondea a tres decimales", () => {
    const r = movimientoDesdeLaLineaDeOdoo(linea({ cantidad: 19.5784 }), CATALOGOS);
    if (r.resultado !== "entra") throw new Error("no entró");
    expect(r.movimiento.toneladas).toBe(19.578);
  });
});
```

- [ ] **Paso 2: Correr y verificar que falla**

```bash
npx vitest run lib/calidad/reconocer.test.ts
```

Esperado: FAIL, `Failed to resolve import "./reconocer"`.

- [ ] **Paso 3: Implementar**

`lib/calidad/reconocer.ts`:

```ts
import type { CarbonReal } from "./types";

/**
 * De una línea de orden de compra de Odoo a un movimiento de stock — o a la
 * bandeja.
 *
 * **Enlazar al que se le parece es peor que dejar en null.** Acá eso significa
 * que nada entra al stock por parecerse: el proveedor tiene que estar declarado
 * como carbonillero y el producto tiene que estar resuelto por id. Lo que no,
 * no entra **y se ve**.
 *
 * Función pura a propósito, como `lib/despacho/ordenDeCarbonilla.ts`: recibe
 * los catálogos ya traídos y devuelve la decisión, así se puede ver antes de
 * escribirla.
 *
 * Spec: docs/superpowers/specs/2026-09-16-calidad-stock-de-carbonilla-design.md
 */

/**
 * Lo que trajo un camión en todo un año, con margen.
 *
 * Atrapa los absurdos y no los verosímiles: la `P02304` con 38.660 —kilos
 * cargados como toneladas— y la `P02292` con 0. Un camión de 45 toneladas pasa,
 * porque pasó.
 */
export const TONELADAS_POSIBLES = { minimo: 0, maximo: 60 } as const;

export interface LineaDeOdoo {
  /** El id de la LÍNEA, no el de la orden: 7 de 577 órdenes del año tienen dos. */
  id: number;
  ordenNombre: string;
  /** `YYYY-MM-DD`, del `date_order` de la orden. */
  fecha: string;
  partnerId: number;
  partnerNombre: string;
  productoId: number;
  productoNombre: string;
  cantidad: number;
}

export interface CarbonilleroResuelto {
  id: string;
  carbon: CarbonReal;
  proveedorId: string | null;
}

export interface Catalogos {
  /** Por `odoo_partner_id`. */
  carbonilleros: Map<number, CarbonilleroResuelto>;
  /** Por `odoo_product_id` → `cuenta`. No estar no es lo mismo que estar en `false`. */
  productos: Map<number, boolean>;
}

export interface MovimientoNuevo {
  fecha: string;
  tipo: "entrada";
  carbon: CarbonReal;
  toneladas: number;
  carbonillero_id: string;
  proveedor_id: string | null;
  origen: "odoo";
  odoo_purchase_line_id: number;
  odoo_purchase_name: string;
  motivo: null;
}

export type Reconocimiento =
  | { resultado: "entra"; movimiento: MovimientoNuevo }
  | { resultado: "a_la_bandeja"; motivo: string }
  /** Resuelto que no cuenta —un flete—. Ni entra ni molesta. */
  | { resultado: "descartado" };

export function movimientoDesdeLaLineaDeOdoo(
  linea: LineaDeOdoo,
  catalogos: Catalogos
): Reconocimiento {
  // El proveedor primero: si no es carbonillero, el producto no importa.
  const carbonillero = catalogos.carbonilleros.get(linea.partnerId);
  if (!carbonillero) {
    return {
      resultado: "a_la_bandeja",
      motivo: `${linea.partnerNombre} (partner ${linea.partnerId}) no está declarado como carbonillero.`,
    };
  }

  const cuenta = catalogos.productos.get(linea.productoId);
  if (cuenta === undefined) {
    return {
      resultado: "a_la_bandeja",
      motivo: `El producto "${linea.productoNombre}" (id ${linea.productoId}) no está resuelto: hay que decir si cuenta como carbonilla o no.`,
    };
  }
  if (cuenta === false) return { resultado: "descartado" };

  if (
    !Number.isFinite(linea.cantidad) ||
    linea.cantidad <= TONELADAS_POSIBLES.minimo ||
    linea.cantidad > TONELADAS_POSIBLES.maximo
  ) {
    return {
      resultado: "a_la_bandeja",
      motivo: `${linea.cantidad} no es una cantidad posible para un camión (se esperan más de ${TONELADAS_POSIBLES.minimo} y hasta ${TONELADAS_POSIBLES.maximo} toneladas). Puede estar cargada en kilos.`,
    };
  }

  return {
    resultado: "entra",
    movimiento: {
      fecha: linea.fecha,
      tipo: "entrada",
      carbon: carbonillero.carbon,
      toneladas: Math.round(linea.cantidad * 1000) / 1000,
      carbonillero_id: carbonillero.id,
      proveedor_id: carbonillero.proveedorId,
      origen: "odoo",
      odoo_purchase_line_id: linea.id,
      odoo_purchase_name: linea.ordenNombre,
      motivo: null,
    },
  };
}
```

- [ ] **Paso 4: Correr y verificar**

```bash
npx vitest run lib/calidad/reconocer.test.ts
```

Esperado: 8 tests en verde.

- [ ] **Paso 5: Commitear**

```bash
git add lib/calidad/reconocer.ts lib/calidad/reconocer.test.ts
git commit -m "feat(calidad): que linea de Odoo es una entrada, y que va a la bandeja"
```

---

## Tarea 8: Las diez celdas de la planilla

**Archivos:**
- Modificar: `lib/core/sheets.ts:114-118` (ensanchar `escribirCeldas`)
- Crear: `lib/calidad/planilla.ts`
- Test: `lib/calidad/planilla.test.ts`

- [ ] **Paso 1: Ensanchar `escribirCeldas` para que acepte números**

En `lib/core/sheets.ts`, cambiar la firma —el cuerpo no cambia, `JSON.stringify` serializa un número igual de bien—:

```ts
export async function escribirCeldas(
  planillaId: string,
  celdas: { pestana: string; columna: number; fila: number; valor: string | number }[]
): Promise<void> {
```

Y sumar arriba de la función, al comentario que ya tenga:

```ts
/*
 * `valor` acepta número desde 16/09/2026, y conviene usarlo.
 *
 * La escritura va con `USER_ENTERED`, así que un `"19,58"` lo interpreta la
 * planilla según su locale — la misma trampa que leyendo m/d en vez de d/m dio
 * vuelta 885 fechas en Compras. `agregarFila` ya aceptaba `string | number`;
 * esto empareja las dos. Un número no se interpreta.
 */
```

- [ ] **Paso 2: Escribir el test que falla**

`lib/calidad/planilla.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { filaDeLaPlanilla, CODIGOS_DE_CONSUMO, CODIGOS_DE_AJUSTE } from "./planilla";

const carbonillero = { nombre_planilla: "BRUZZONE JUAN ALBERTO", codigo_planilla: "00003" };
const saldos = { saldoTotal: 345.997, saldoVegetal: 269.9, saldoResidual: 76.097 };

describe("filaDeLaPlanilla", () => {
  it("una entrada: código y nombre del carbonillero, y las toneladas en ENTRADAS", () => {
    const fila = filaDeLaPlanilla(
      { tipo: "entrada", carbon: "vegetal", toneladas: 19.58, fecha: "2026-09-04" },
      { carbonillero, ...saldos }
    );
    expect(fila).toEqual([
      "00003",
      "BRUZZONE JUAN ALBERTO",
      19.58,
      "",
      345.997,
      269.9,
      76.097,
      46269,
      "",
      "",
    ]);
  });

  it("un consumo vegetal: el código 00015 y las toneladas en SALIDAS, en positivo", () => {
    const fila = filaDeLaPlanilla(
      { tipo: "consumo", carbon: "vegetal", toneladas: -37, fecha: "2026-09-04" },
      saldos
    );
    expect(fila[0]).toBe(CODIGOS_DE_CONSUMO.vegetal);
    expect(fila[1]).toBe("CONSUMO VEGETAL");
    expect(fila[2]).toBe("");
    expect(fila[3]).toBe(37);
  });

  it("un consumo residual usa el 00016", () => {
    const fila = filaDeLaPlanilla(
      { tipo: "consumo", carbon: "residual", toneladas: -12, fecha: "2026-09-04" },
      saldos
    );
    expect(fila[0]).toBe(CODIGOS_DE_CONSUMO.residual);
    expect(fila[1]).toBe("CONSUMO RESIDUAL");
  });

  it("un ajuste en menos cae en SALIDAS", () => {
    const fila = filaDeLaPlanilla(
      { tipo: "ajuste", carbon: "vegetal", toneladas: -46, fecha: "2026-04-20" },
      saldos
    );
    expect(fila[0]).toBe(CODIGOS_DE_AJUSTE.vegetal);
    expect(fila[1]).toBe("AJUSTE VEGETAL");
    expect(fila[2]).toBe("");
    expect(fila[3]).toBe(46);
  });

  it("un ajuste en más cae en ENTRADAS — lo que la fórmula vieja no sabía hacer", () => {
    const fila = filaDeLaPlanilla(
      { tipo: "ajuste", carbon: "vegetal", toneladas: 232.5, fecha: "2026-05-02" },
      saldos
    );
    expect(fila[2]).toBe(232.5);
    expect(fila[3]).toBe("");
  });

  it("la fecha va como serial y nunca como texto", () => {
    const fila = filaDeLaPlanilla(
      { tipo: "consumo", carbon: "vegetal", toneladas: -37, fecha: "2026-09-09" },
      saldos
    );
    expect(typeof fila[7]).toBe("number");
    // 46274 es el serial que la planilla real tiene en las filas del 09/09/2026.
    expect(fila[7]).toBe(46274);
  });

  it("el conteo físico y su desvío, cuando el movimiento los trae", () => {
    const fila = filaDeLaPlanilla(
      { tipo: "consumo", carbon: "vegetal", toneladas: -29, fecha: "2026-09-11" },
      { ...saldos, conteo: { contadas: 298, desvio: -28.857 } }
    );
    expect(fila[8]).toBe(298);
    expect(fila[9]).toBe(-28.857);
  });
});
```

- [ ] **Paso 3: Correr y verificar que falla**

```bash
npx vitest run lib/calidad/planilla.test.ts
```

Esperado: FAIL, `Failed to resolve import "./planilla"`.

- [ ] **Paso 4: Implementar**

`lib/calidad/planilla.ts`:

```ts
import { serialDelDia } from "@/lib/core/fechaDeSheets";
import type { CarbonReal, TipoDeMovimiento, TipoDeCarbon } from "./types";

/**
 * Las diez celdas de una fila de `Entradas  Salidas` —con los dos espacios—.
 *
 * Función pura: no habla con Google. La escritura vive en `espejo.ts`.
 *
 * **SE ESCRIBEN LAS DIEZ, FÓRMULAS INCLUIDAS.** Es una excepción deliberada a
 * "pisar una fórmula la convierte en dato muerto", con tres razones medidas:
 *
 *   1. La fórmula de `RESIDUAL` está cableada al código `00010` (Membranex), así
 *      que un segundo proveedor residual lo contaría como vegetal.
 *   2. No puede representar un ajuste en más: suma sólo por `ENTRADAS` y sólo
 *      con un código de proveedor. Por eso el 02/05/2026 alguien tuvo que pisar
 *      la celda del saldo a mano.
 *   3. Acá manda el sistema. Dejar la fórmula viva sería sostener dos saldos que
 *      discrepan.
 *
 * **Nada va como texto.** La escritura usa `USER_ENTERED`: un `"19,58"` lo
 * interpreta la planilla según su locale. La fecha va como serial y las
 * toneladas como número.
 */

export const PESTANA = "Entradas  Salidas";

/** La columna que dice hasta dónde llegan los datos. La `B` no sirve: tiene un VLOOKUP precargado más abajo. */
export const COLUMNA_QUE_MANDA = "A";

export const CODIGOS_DE_CONSUMO: Record<CarbonReal, string> = {
  vegetal: "00015",
  residual: "00016",
};

/**
 * Los dos códigos que hay que dar de alta en `Listado articulos GRAL`.
 *
 * No existen todavía: hoy el ajuste se carga como consumo y la explicación va
 * en la columna del conteo físico. Están en "lo que falta de una persona".
 */
export const CODIGOS_DE_AJUSTE: Record<CarbonReal, string> = {
  vegetal: "00019",
  residual: "00020",
};

export type CeldaDePlanilla = string | number;

export interface MovimientoParaLaPlanilla {
  tipo: TipoDeMovimiento;
  carbon: TipoDeCarbon;
  /** Con signo, como está guardado. */
  toneladas: number;
  fecha: string;
}

export interface ContextoDeLaFila {
  /** Sólo en una entrada. */
  carbonillero?: { nombre_planilla: string; codigo_planilla: string };
  saldoTotal: number;
  saldoVegetal: number;
  saldoResidual: number;
  /** Si ese mismo día se contó el stock. */
  conteo?: { contadas: number; desvio: number };
}

function codigoYDescripcion(
  m: MovimientoParaLaPlanilla,
  ctx: ContextoDeLaFila
): [string, string] {
  if (m.tipo === "entrada") {
    if (!ctx.carbonillero) {
      throw new Error("Una entrada necesita su carbonillero para escribirse en la planilla.");
    }
    return [ctx.carbonillero.codigo_planilla, ctx.carbonillero.nombre_planilla];
  }
  // Los `sin_separar` son historia importada y no se escriben: la planilla ya
  // los tiene. Si llegara uno acá es un error de quien llama.
  if (m.carbon === "sin_separar") {
    throw new Error("Un movimiento sin_separar no se escribe en la planilla: ya está.");
  }
  return m.tipo === "consumo"
    ? [CODIGOS_DE_CONSUMO[m.carbon], `CONSUMO ${m.carbon.toUpperCase()}`]
    : [CODIGOS_DE_AJUSTE[m.carbon], `AJUSTE ${m.carbon.toUpperCase()}`];
}

export function filaDeLaPlanilla(
  m: MovimientoParaLaPlanilla,
  ctx: ContextoDeLaFila
): CeldaDePlanilla[] {
  const [codigo, descripcion] = codigoYDescripcion(m, ctx);

  // El signo decide la columna, no el tipo: un ajuste en más suma como una
  // entrada y uno en menos resta como un consumo.
  const entradas = m.toneladas > 0 ? m.toneladas : "";
  const salidas = m.toneladas < 0 ? -m.toneladas : "";

  const serial = serialDelDia(m.fecha);
  if (serial === null) throw new Error(`La fecha ${m.fecha} no se puede escribir en la planilla.`);

  return [
    codigo,
    descripcion,
    entradas,
    salidas,
    ctx.saldoTotal,
    ctx.saldoVegetal,
    ctx.saldoResidual,
    serial,
    ctx.conteo ? ctx.conteo.contadas : "",
    ctx.conteo ? ctx.conteo.desvio : "",
  ];
}
```

- [ ] **Paso 5: Correr y verificar**

```bash
npx vitest run lib/calidad/planilla.test.ts
npm test
npx tsc --noEmit
```

Esperado: los 7 tests nuevos en verde y la suite entera igual que antes. Si `escribirCeldas` rompió algún llamador, es porque ensanchar un tipo de entrada no rompe nada — si rompe, revisá que no hayas cambiado también el tipo de retorno.

- [ ] **Paso 6: Commitear**

```bash
git add lib/core/sheets.ts lib/calidad/planilla.ts lib/calidad/planilla.test.ts
git commit -m "feat(calidad): las diez celdas de la fila, con numero y serial en vez de texto"
```

---

# Parte 3 — Traer y sincronizar

## Tarea 9: Las consultas

**Archivos:**
- Crear: `lib/calidad/consultas.ts`

Sin tests: son lecturas a Supabase, y en este repo se testean las funciones puras. Lo que se prueba acá es que compile y que la pantalla muestre datos.

- [ ] **Paso 1: Escribir las consultas**

`lib/calidad/consultas.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import { saldosDelLibro, saldoCorrido, type Saldos } from "./movimientos";
import type { Carbonillero, CarbonReal, Movimiento, ProductoDeOdoo, LineaSinReconocer } from "./types";

/**
 * Traer lo que hace falta para mostrar el stock.
 *
 * **Todo con `traerTodo()`.** PostgREST corta en 1000 filas y no avisa: un
 * `.limit(3000)` devuelve 1000. El libro son mil movimientos por año y arranca
 * con veinte meses importados, así que ya nace del otro lado del corte. No
 * razonar "esta tabla es chica": el tablero de Compras parecía una cola acotada
 * y arrastra 1.900 filas.
 */

export async function traerCarbonilleros(supabase: SupabaseClient): Promise<Carbonillero[]> {
  return traerTodo<Carbonillero>((desde, hasta) =>
    supabase
      .from("calidad_carbonilleros")
      .select("id, odoo_partner_id, empresa_id, proveedor_id, carbon, nombre_planilla, codigo_planilla, activo")
      .order("nombre_planilla")
      .range(desde, hasta)
  );
}

export async function traerProductosDeOdoo(supabase: SupabaseClient): Promise<ProductoDeOdoo[]> {
  return traerTodo<ProductoDeOdoo>((desde, hasta) =>
    supabase
      .from("calidad_productos_odoo")
      .select("odoo_product_id, odoo_product_nombre, cuenta")
      .order("odoo_product_nombre")
      .range(desde, hasta)
  );
}

/** Todos los movimientos. Hace falta entero para el saldo: un saldo parcial no es un saldo. */
export async function traerMovimientos(supabase: SupabaseClient): Promise<Movimiento[]> {
  return traerTodo<Movimiento>((desde, hasta) =>
    supabase
      .from("calidad_movimientos")
      .select(
        "id, fecha, tipo, carbon, toneladas, motivo, carbonillero_id, proveedor_id, origen, odoo_purchase_line_id, odoo_purchase_name, despacho_recepcion_id, sheets_fila, sheets_pendiente, sheets_pendiente_en, cargado_por, cargado_en, actualizado_por, actualizado_en"
      )
      .order("fecha")
      .order("cargado_en")
      .range(desde, hasta)
  );
}

export async function traerBandeja(supabase: SupabaseClient): Promise<LineaSinReconocer[]> {
  return traerTodo<LineaSinReconocer>((desde, hasta) =>
    supabase
      .from("calidad_odoo_sin_reconocer")
      .select("*")
      .order("fecha", { ascending: false })
      .range(desde, hasta)
  );
}

export interface ElStock {
  saldos: Saldos;
  movimientos: Movimiento[];
  /** El del último movimiento cargado, para que la pantalla diga cuán viejo es lo que muestra. */
  ultimaFecha: string | null;
  /** El último consumo, por tipo: es el aviso que sirve. */
  ultimoConsumo: { vegetal: string | null; residual: string | null };
}

export async function traerElStock(supabase: SupabaseClient): Promise<ElStock> {
  const movimientos = await traerMovimientos(supabase);
  const consumos = movimientos.filter((m) => m.tipo === "consumo");

  const ultimoDe = (carbon: string) =>
    consumos.filter((m) => m.carbon === carbon).at(-1)?.fecha ?? null;

  return {
    saldos: saldosDelLibro(movimientos),
    movimientos,
    ultimaFecha: movimientos.at(-1)?.fecha ?? null,
    ultimoConsumo: { vegetal: ultimoDe("vegetal"), residual: ultimoDe("residual") },
  };
}

/** El saldo teórico de un tipo **hoy**, que es contra lo que se compara un conteo. */
export async function teoricoDe(
  supabase: SupabaseClient,
  carbon: CarbonReal
): Promise<number> {
  const movimientos = await traerMovimientos(supabase);
  return saldosDelLibro(movimientos)[carbon];
}

export { saldoCorrido };
```

- [ ] **Paso 2: Verificar y commitear**

```bash
npx tsc --noEmit
git add lib/calidad/consultas.ts
git commit -m "feat(calidad): las consultas del libro, con traerTodo"
```

---

## Tarea 10: La sincronización con Odoo

**Archivos:**
- Crear: `lib/calidad/sincronizar.ts`

- [ ] **Paso 1: Escribir la sincronización**

`lib/calidad/sincronizar.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarLeer } from "@/lib/odoo/client";
import { hoyEnArgentina, sumarDias } from "@/lib/core/fechas";
import { movimientoDesdeLaLineaDeOdoo, type Catalogos, type LineaDeOdoo } from "./reconocer";
import { traerCarbonilleros, traerProductosDeOdoo } from "./consultas";

/**
 * Traer de Odoo las entradas de carbonilla que todavía no están en el libro.
 *
 * LA VENTANA VA SOBRE `create_date`, NO SOBRE `date_order`, y es la decisión que
 * importa de este archivo. Se midió: 1.053 de 1.055 órdenes del año se cargan el
 * mismo día, pero el máximo son 3 días — y al 16/09/2026 hay once días sin
 * cargar. Una orden fechada el 05/09 y cargada el 20/09 **la ventana de
 * `date_order` no la ve nunca**: se la pasa por atrás mientras el cron avanza.
 * Con `create_date` eso no puede pasar.
 *
 * El margen es fijo contra hoy y no contra la última corrida: una corrida que se
 * saltó no abre un hueco.
 *
 * NUNCA PISA. Si una orden que ya entró cambia de cantidad en Odoo, el
 * movimiento no se reescribe: va a la bandeja y una persona decide. Un saldo que
 * se mueve solo hacia atrás no se nota hasta el conteo.
 */

const DIAS_DE_MARGEN = 30;

/**
 * El cron nunca mira antes de esto: es lo único que evita que el histórico
 * importado se duplique cuando la sincronización pase por las mismas órdenes.
 * Se pone el día en que corrió `scripts/importar-stock-carbonilla.mts`.
 */
export const CALIDAD_DESDE = process.env.CALIDAD_DESDE ?? "2026-09-16";

export interface ResumenDeSincronizacion {
  leidas: number;
  nuevas: number;
  yaEstaban: number;
  descartadas: number;
  aLaBandeja: number;
  cambiadasEnOdoo: number;
}

export async function sincronizarCarbonillaConOdoo(
  supabase: SupabaseClient
): Promise<ResumenDeSincronizacion> {
  const [carbonilleros, productos] = await Promise.all([
    traerCarbonilleros(supabase),
    traerProductosDeOdoo(supabase),
  ]);

  const activos = carbonilleros.filter((c) => c.activo);
  if (activos.length === 0) {
    return { leidas: 0, nuevas: 0, yaEstaban: 0, descartadas: 0, aLaBandeja: 0, cambiadasEnOdoo: 0 };
  }

  const catalogos: Catalogos = {
    carbonilleros: new Map(
      activos.map((c) => [c.odoo_partner_id, { id: c.id, carbon: c.carbon, proveedorId: c.proveedor_id }])
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

  // La fecha del movimiento es la del papel (`date_order`), no la de carga.
  const ordenIds = [...new Set(crudas.map((l) => l.order_id[0]))];
  const ordenes = ordenIds.length
    ? await buscarLeer<{ id: number; date_order: string }>(
        "purchase.order",
        [["id", "in", ordenIds]],
        ["id", "date_order"],
        { limite: 2000 }
      )
    : [];
  const fechaDeOrden = new Map(ordenes.map((o) => [o.id, String(o.date_order).slice(0, 10)]));

  const lineas: LineaDeOdoo[] = crudas.map((l) => ({
    id: l.id,
    ordenNombre: l.order_id[1],
    fecha: fechaDeOrden.get(l.order_id[0]) ?? "",
    partnerId: l.partner_id[0],
    partnerNombre: l.partner_id[1],
    productoId: l.product_id[0],
    productoNombre: l.product_id[1],
    cantidad: l.product_qty,
  }));

  // Lo que ya está en el libro, para no pisarlo y para detectar los cambios.
  const { data: yaHay } = await supabase
    .from("calidad_movimientos")
    .select("odoo_purchase_line_id, odoo_purchase_name, toneladas")
    .in("odoo_purchase_line_id", lineas.map((l) => l.id).slice(0, 200));
  const guardadas = new Map((yaHay ?? []).map((m) => [m.odoo_purchase_line_id as number, m]));

  const resumen: ResumenDeSincronizacion = {
    leidas: lineas.length, nuevas: 0, yaEstaban: 0, descartadas: 0, aLaBandeja: 0, cambiadasEnOdoo: 0,
  };

  for (const linea of lineas) {
    // La fecha de corte: el histórico importado no se vuelve a traer.
    if (!linea.fecha || linea.fecha < CALIDAD_DESDE) continue;

    const guardada = guardadas.get(linea.id);
    if (guardada) {
      resumen.yaEstaban++;
      const guardado = Math.abs(Number(guardada.toneladas));
      if (Math.abs(guardado - linea.cantidad) > 0.0005) {
        resumen.cambiadasEnOdoo++;
        await supabase.from("calidad_odoo_sin_reconocer").upsert({
          odoo_purchase_line_id: linea.id,
          odoo_purchase_name: linea.ordenNombre,
          odoo_partner_id: linea.partnerId,
          odoo_partner_nombre: linea.partnerNombre,
          odoo_product_id: linea.productoId,
          odoo_product_nombre: linea.productoNombre,
          fecha: linea.fecha,
          toneladas: linea.cantidad,
          motivo: `La ${linea.ordenNombre} pasó de ${guardado} a ${linea.cantidad} toneladas después de haber entrado al stock. El movimiento NO se cambió: decidilo vos.`,
        });
      }
      continue;
    }

    const r = movimientoDesdeLaLineaDeOdoo(linea, catalogos);

    if (r.resultado === "descartado") { resumen.descartadas++; continue; }

    if (r.resultado === "a_la_bandeja") {
      resumen.aLaBandeja++;
      await supabase.from("calidad_odoo_sin_reconocer").upsert({
        odoo_purchase_line_id: linea.id,
        odoo_purchase_name: linea.ordenNombre,
        odoo_partner_id: linea.partnerId,
        odoo_partner_nombre: linea.partnerNombre,
        odoo_product_id: linea.productoId,
        odoo_product_nombre: linea.productoNombre,
        fecha: linea.fecha,
        toneladas: linea.cantidad,
        motivo: r.motivo,
      });
      continue;
    }

    // `DO NOTHING` y no `DO UPDATE`: si la recepción de Despacho ya la guardó
    // con su propio origen, la sincronización no la toca. Ése es todo el
    // mecanismo anti-duplicado.
    const { error } = await supabase
      .from("calidad_movimientos")
      .upsert(r.movimiento, { onConflict: "odoo_purchase_line_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);

    resumen.nuevas++;
    await supabase.from("calidad_odoo_sin_reconocer").delete().eq("odoo_purchase_line_id", linea.id);
  }

  return resumen;
}
```

**Ojo con el `.in()`**: se cortan los ids en lotes de 200 porque un `.in()` con muchos arma una URL que PostgREST rechaza con un 400 sin decir por qué. Si en algún momento hay más de 200 líneas en la ventana, hay que hacerlo por lotes — está anotado como mejora en la tarea 23.

- [ ] **Paso 2: Verificar y commitear**

```bash
npx tsc --noEmit
git add lib/calidad/sincronizar.ts
git commit -m "feat(calidad): la sincronizacion con Odoo, por create_date y sin pisar"
```

---

## Tarea 11: El cron y el botón

**Archivos:**
- Crear: `app/api/cron/calidad-sync/route.ts`
- Crear: `app/api/calidad/sincronizar/route.ts`
- Modificar: `vercel.json`

- [ ] **Paso 1: El cron**

`app/api/cron/calidad-sync/route.ts`:

```ts
import { NextResponse } from "next/server";
import { revisarElSecreto } from "@/lib/core/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { hayCredencialesOdoo } from "@/lib/odoo/client";
import { registrarSincronizacion } from "@/lib/core/sincronizaciones";
import { sincronizarCarbonillaConOdoo } from "@/lib/calidad/sincronizar";

export const maxDuration = 300;

/**
 * Trae una vez por día las entradas de carbonilla que se cargaron en Odoo.
 *
 * A las 8 UTC —cinco de la mañana acá—, que es el hueco libre entre los cinco
 * crons que ya hay, y antes de que alguien abra la pantalla a la mañana.
 *
 * Falla cerrado: sin `CRON_SECRET` devuelve 503 en vez de quedar abierto a
 * cualquiera que conozca la URL.
 */
export async function GET(request: Request) {
  const rechazo = revisarElSecreto(request);
  if (rechazo) return rechazo;

  if (!hayCredencialesOdoo()) {
    return NextResponse.json({ omitido: "Odoo no está configurado" });
  }

  try {
    const resumen = await sincronizarCarbonillaConOdoo(createAdminClient());
    // Se anota también cuando falla: una fecha vieja sin explicación es lo que
    // hace que nadie sepa si está mirando datos al día.
    await registrarSincronizacion({
      modulo: "calidad", recurso: "carbonilla-odoo", ok: true, filas: resumen.nuevas,
    });
    return NextResponse.json(resumen);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await registrarSincronizacion({ modulo: "calidad", recurso: "carbonilla-odoo", ok: false, error });
    return NextResponse.json({ error }, { status: 500 });
  }
}
```

- [ ] **Paso 2: El botón**

`app/api/calidad/sincronizar/route.ts`: mismo cuerpo, pero en vez de `revisarElSecreto` chequea sesión y `puedeEditarCalidad(supabase, user.id)`, devolviendo 403 si no. Copiá el patrón de autenticación de `app/api/despacho/recepciones/route.ts`, que ya lo tiene resuelto para este módulo hermano.

- [ ] **Paso 3: El cron en `vercel.json`**

Agregar al array `crons`:

```json
{
  "path": "/api/cron/calidad-sync",
  "schedule": "0 8 * * *"
}
```

- [ ] **Paso 4: Verificar y commitear**

```bash
npx tsc --noEmit
git add app/api/cron/calidad-sync/route.ts app/api/calidad/sincronizar/route.ts vercel.json
git commit -m "feat(calidad): el cron diario y el boton de sincronizar ahora"
```

---

# Parte 4 — El espejo

## Tarea 12: Escribir la planilla

**Archivos:**
- Crear: `lib/calidad/espejo.ts`

- [ ] **Paso 1: Escribir el espejo**

`lib/calidad/espejo.ts`, calcado de `lib/despacho/espejoRecepcion.ts`:

```ts
import { agregarFila, escribirCeldas } from "@/lib/core/sheets";
import { hayCredencialesGoogle } from "@/lib/core/google";
import { filaDeLaPlanilla, PESTANA, COLUMNA_QUE_MANDA, type CeldaDePlanilla,
         type MovimientoParaLaPlanilla, type ContextoDeLaFila } from "./planilla";

/**
 * Escribir en la planilla de stock el movimiento que se acaba de cargar.
 *
 * Acá manda el sistema, como en Producción y en las órdenes de carga: la
 * planilla queda como el lugar donde miran los que no entran al SdG, y su
 * llenado a mano desaparece.
 *
 * **No lanza: devuelve qué pasó.** Quien lo llama anota el pendiente con lo que
 * dijo Google **sin traducir** y se lo dice a quien guardó. Un fallo de
 * escritura no es un `console.warn`: eso costó una tarde entera en Compras.
 *
 * El libro tiene una sola pestaña de datos. La columna que manda es la `A`
 * (`CODIGO`) y **no la `B`**: la `B` tiene un `VLOOKUP` precargado cientos de
 * filas más abajo de los datos, así que por ahí la "última fila con algo" sale
 * mal y la escritura pisaría.
 */

const PLANILLA = () => process.env.GOOGLE_SHEETS_STOCK_CARBONILLA_ID ?? "";

export interface ResultadoEspejo {
  ok: boolean;
  /** En qué fila quedó, para poder reescribirla al corregir. */
  fila?: number;
  /** Qué dijo Google, sin traducir. */
  error?: string;
}

/** Si el espejo puede intentar escribir. Sin esto el movimiento queda pendiente, no falla. */
export function hayEspejoDeStock(): boolean {
  return hayCredencialesGoogle() && Boolean(PLANILLA());
}

export async function escribirMovimiento(
  movimiento: MovimientoParaLaPlanilla,
  contexto: ContextoDeLaFila,
  filaExistente: number | null
): Promise<ResultadoEspejo> {
  if (!hayEspejoDeStock()) {
    return { ok: false, error: "Falta GOOGLE_SHEETS_STOCK_CARBONILLA_ID o las credenciales de Google." };
  }

  let celdas: CeldaDePlanilla[];
  try {
    celdas = filaDeLaPlanilla(movimiento, contexto);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  try {
    if (filaExistente === null) {
      const fila = await agregarFila(PLANILLA(), PESTANA, celdas, COLUMNA_QUE_MANDA);
      return { ok: true, fila };
    }
    await escribirCeldas(
      PLANILLA(),
      celdas.map((valor, columna) => ({ pestana: PESTANA, columna, fila: filaExistente, valor }))
    );
    return { ok: true, fila: filaExistente };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

- [ ] **Paso 2: Verificar y commitear**

```bash
npx tsc --noEmit
git add lib/calidad/espejo.ts
git commit -m "feat(calidad): el espejo de la planilla, de una sola via"
```

---

# Parte 5 — Las rutas

## Tarea 13: Alta y corrección de movimientos

**Archivos:**
- Crear: `app/api/calidad/movimientos/route.ts`
- Crear: `app/api/calidad/movimientos/[id]/route.ts`

- [ ] **Paso 1: Escribir el helper que exporta, que lo comparten las dos rutas**

Al final de `lib/calidad/espejo.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { saldoCorrido } from "./movimientos";
import { traerMovimientos, traerCarbonilleros } from "./consultas";

/**
 * Escribir en la planilla un movimiento **que ya está guardado**, con el saldo
 * que le corresponde en su lugar del libro.
 *
 * Se llama después de guardar y nunca antes: el saldo de una fila es el que
 * queda después de ella, así que el movimiento tiene que existir para poder
 * calcularlo.
 *
 * **Nunca lanza.** Deja anotado el pendiente con lo que dijo Google sin
 * traducir y devuelve el aviso para que la ruta se lo diga a quien guardó. Un
 * fallo de escritura no puede deshacer un dato que ya se cargó bien.
 */
export async function exportarMovimiento(
  supabase: SupabaseClient,
  movimientoId: string
): Promise<{ aviso: string | null }> {
  const [movimientos, carbonilleros] = await Promise.all([
    traerMovimientos(supabase),
    traerCarbonilleros(supabase),
  ]);

  const filas = saldoCorrido(movimientos);
  const fila = filas.find((f) => f.movimiento.id === movimientoId);
  if (!fila) return { aviso: "No se encontró el movimiento para exportarlo." };

  const m = fila.movimiento;

  // Los `sin_separar` son historia importada: la planilla ya los tiene y su
  // fila original está en `sheets_fila`. No se reescriben.
  if (m.carbon === "sin_separar") return { aviso: null };

  const carbonillero = m.carbonillero_id
    ? carbonilleros.find((c) => c.id === m.carbonillero_id)
    : undefined;

  const r = await escribirMovimiento(
    { tipo: m.tipo, carbon: m.carbon, toneladas: m.toneladas, fecha: m.fecha },
    {
      carbonillero,
      saldoTotal: fila.saldoTotal,
      saldoVegetal: fila.saldoVegetal,
      saldoResidual: fila.saldoResidual,
    },
    m.sheets_fila
  );

  if (r.ok) {
    await supabase
      .from("calidad_movimientos")
      .update({ sheets_fila: r.fila, sheets_pendiente: null, sheets_pendiente_en: null })
      .eq("id", movimientoId);
    return { aviso: null };
  }

  await supabase
    .from("calidad_movimientos")
    .update({ sheets_pendiente: r.error, sheets_pendiente_en: new Date().toISOString() })
    .eq("id", movimientoId);

  return {
    aviso: `El movimiento se guardó, pero no se pudo escribir en la planilla: ${r.error}`,
  };
}
```

- [ ] **Paso 2: Escribir el POST**

`app/api/calidad/movimientos/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeEditarCalidad } from "@/lib/calidad/auth";
import { efectoEnElSaldo } from "@/lib/calidad/movimientos";
import { exportarMovimiento } from "@/lib/calidad/espejo";
import type { TipoDeMovimiento, CarbonReal } from "@/lib/calidad/types";

/**
 * Cargar un movimiento: el consumo del día, un ajuste, o una entrada a mano.
 *
 * TODA RUTA QUE TOQUE UN CAMPO QUE SE EXPORTA TIENE QUE EXPORTAR, y si no
 * puede, dejar el pendiente anotado. Cambiar un saldo sin escribirlo en la
 * planilla es una divergencia que no avisa.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  if (!(await puedeEditarCalidad(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const cuerpo = await cuerpoJson<{
    fecha: string;
    tipo: TipoDeMovimiento;
    carbon: CarbonReal;
    toneladas: number;
    motivo?: string | null;
    carbonillero_id?: string | null;
  }>(request);

  // El signo lo decide la función pura, no la pantalla ni la ruta. Los CHECK de
  // la base dicen lo mismo, así que si esto se saltea el insert falla igual.
  const efecto = efectoEnElSaldo(cuerpo.tipo, cuerpo.toneladas);
  if (efecto.problema) return NextResponse.json({ error: efecto.problema }, { status: 400 });

  const { data, error } = await supabase
    .from("calidad_movimientos")
    .insert({
      fecha: cuerpo.fecha,
      tipo: cuerpo.tipo,
      carbon: cuerpo.carbon,
      toneladas: efecto.toneladas,
      motivo: cuerpo.tipo === "ajuste" ? (cuerpo.motivo ?? null) : null,
      carbonillero_id: cuerpo.tipo === "entrada" ? (cuerpo.carbonillero_id ?? null) : null,
      origen: "manual",
      cargado_por: user.id,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // El dato ya está guardado: de acá en más nada puede fallar el alta.
  const { aviso } = await exportarMovimiento(supabase, data.id);
  return NextResponse.json({ id: data.id, aviso });
}
```

- [ ] **Paso 3: Escribir el PATCH**

`app/api/calidad/movimientos/[id]/route.ts`: la misma forma, con
`.update({...}).eq("id", id)` y `actualizado_por` / `actualizado_en`, seguido de
`exportarMovimiento(supabase, id)`.

**Una corrección mueve el saldo de todo lo que vino después.** La planilla no se
reescribe entera —serían cientos de filas por una corrección—: se reescribe la
fila del movimiento y se marcan las posteriores con `sheets_pendiente` de una
línea, *"el saldo de esta fila cambió porque se corrigió un movimiento
anterior"*, que el botón de reintentar de la pantalla va resolviendo. Queda
escrito en `docs/CALIDAD.md` como lo que es: una divergencia **conocida y
visible**, que es lo contrario de la que tiene hoy la planilla.

- [ ] **Paso 2: Verificar y commitear**

```bash
npx tsc --noEmit
git add app/api/calidad/movimientos/route.ts app/api/calidad/movimientos/\[id\]/route.ts
git commit -m "feat(calidad): alta y correccion de movimientos, con el espejo en la misma ruta"
```

---

## Tarea 14: El conteo y su ajuste

**Archivos:**
- Crear: `app/api/calidad/conteos/route.ts`

- [ ] **Paso 1: Escribir la ruta**

`app/api/calidad/conteos/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeEditarCalidad } from "@/lib/calidad/auth";
import { teoricoDe } from "@/lib/calidad/consultas";
import { desvioDelConteo } from "@/lib/calidad/conteos";
import { exportarMovimiento } from "@/lib/calidad/espejo";
import type { CarbonReal } from "@/lib/calidad/types";

/** El teórico de hoy, para que la pantalla muestre el desvío mientras se tipea. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });

  const carbon = new URL(request.url).searchParams.get("carbon");
  if (carbon !== "vegetal" && carbon !== "residual") {
    return NextResponse.json({ error: "Falta el tipo de carbón." }, { status: 400 });
  }
  return NextResponse.json({ teorico: await teoricoDe(supabase, carbon) });
}

/**
 * Guardar un conteo físico y, si se explicó por qué, el ajuste que lo cierra.
 *
 * EL CONTEO SIN AJUSTE ES UN ESTADO VÁLIDO. Obligar a ajustar en el momento
 * haría que alguien escriba cualquier cosa en el motivo para poder seguir, y un
 * motivo de relleno en un ajuste de 247 toneladas es peor que ningún ajuste.
 * En veinte meses hubo 34 conteos y el saldo teórico siguió de largo en casi
 * todos: la diferencia es que ahora se ve.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  if (!(await puedeEditarCalidad(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const cuerpo = await cuerpoJson<{
    fecha: string;
    carbon: CarbonReal;
    toneladas_contadas: number;
    motivo?: string | null;
    notas?: string | null;
  }>(request);

  // EL TEÓRICO SE CONGELA ACÁ. No es el saldo de hoy leído mañana: es el que el
  // sistema decía en este momento. Si después se corrige un movimiento viejo, el
  // desvío que una persona miró y explicó tiene que poder reconstruirse.
  const teorico = await teoricoDe(supabase, cuerpo.carbon);
  const d = desvioDelConteo(cuerpo.toneladas_contadas, teorico);
  if (d.problema) return NextResponse.json({ error: d.problema }, { status: 400 });

  const { data: conteo, error } = await supabase
    .from("calidad_conteos")
    .insert({
      fecha: cuerpo.fecha,
      carbon: cuerpo.carbon,
      toneladas_contadas: cuerpo.toneladas_contadas,
      teorico_al_contar: teorico,
      notas: cuerpo.notas ?? null,
      cargado_por: user.id,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const motivo = (cuerpo.motivo ?? "").trim();
  if (!d.hayDesvio || !motivo) {
    return NextResponse.json({
      conteo_id: conteo.id,
      desvio: d.desvio,
      ajustado: false,
      teorico,
    });
  }

  const { data: ajuste, error: errorAjuste } = await supabase
    .from("calidad_movimientos")
    .insert({
      fecha: cuerpo.fecha,
      tipo: "ajuste",
      carbon: cuerpo.carbon,
      toneladas: d.ajuste!.toneladas,
      motivo,
      origen: "manual",
      cargado_por: user.id,
    })
    .select("id")
    .single();
  if (errorAjuste) {
    // El conteo ya quedó guardado y eso está bien: es un dato por sí mismo.
    return NextResponse.json(
      { conteo_id: conteo.id, desvio: d.desvio, ajustado: false, error: errorAjuste.message },
      { status: 400 }
    );
  }

  await supabase.from("calidad_conteos").update({ ajuste_id: ajuste.id }).eq("id", conteo.id);
  const { aviso } = await exportarMovimiento(supabase, ajuste.id);

  return NextResponse.json({
    conteo_id: conteo.id, desvio: d.desvio, ajustado: true, ajuste_id: ajuste.id, aviso,
  });
}
```

- [ ] **Paso 2: Verificar y commitear**

```bash
npx tsc --noEmit
git add app/api/calidad/conteos/route.ts
git commit -m "feat(calidad): el conteo fisico y el ajuste que lo cierra"
```

---

## Tarea 15: Los dos catálogos

**Archivos:**
- Crear: `app/api/calidad/carbonilleros/route.ts`
- Crear: `app/api/calidad/productos/route.ts`

- [ ] **Paso 1: `carbonilleros`**

`GET` devuelve los carbonilleros **más** los partners de Odoo que aparecieron en la bandeja y no están declarados, para poder darlos de alta desde ahí sin ir a buscar el id.

`POST`/`PATCH` (sólo `esAdminCalidad`) guardan `odoo_partner_id`, `empresa_id`, `carbon`, `nombre_planilla`, `codigo_planilla`, `proveedor_id` (opcional) y `activo`.

Al guardar, **borrar de la bandeja** las líneas de ese partner que estaban ahí sólo por no estar declarado: la próxima corrida las levanta.

- [ ] **Paso 2: `productos`**

`GET` devuelve la lista blanca **más** los `odoo_product_id` que están en la bandeja sin resolver, con su nombre, para poder decidir ahí mismo.

`POST` (sólo `esAdminCalidad`) hace `upsert` de `{ odoo_product_id, odoo_product_nombre, cuenta }` y borra de la bandeja las líneas de ese producto.

**El nombre se cachea y la elección es por id.** En esta base `CARBONILLA` (6909) y `CARBONILLA ` (4419) se ven idénticos en un desplegable: mostrá el id al lado del nombre.

- [ ] **Paso 3: Verificar y commitear**

```bash
npx tsc --noEmit
git add app/api/calidad/carbonilleros/route.ts app/api/calidad/productos/route.ts
git commit -m "feat(calidad): los dos catalogos que se declaran a mano"
```

---

# Parte 6 — Las pantallas

## Tarea 16: El stock

**Archivos:**
- Crear: `app/(app)/calidad/page.tsx`
- Crear: `app/(app)/calidad/StockClient.tsx`

- [ ] **Paso 1: El Server Component**

`app/(app)/calidad/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelCalidadDe } from "@/lib/calidad/auth";
import { traerElStock, traerBandeja, traerCarbonilleros, saldoCorrido } from "@/lib/calidad/consultas";
import { ultimaSincronizacionDe } from "@/lib/core/sincronizaciones";
import StockClient from "./StockClient";

/**
 * El stock de carbonilla: los dos saldos, el consumo del día y el libro del mes.
 *
 * Es la pantalla que se abre a la tarde para cargar lo que se quemó, que es lo
 * que se hace 224 de 256 días. Todo lo demás está pero más chico.
 */
export default async function CalidadPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelCalidadDe(supabase, user.id);
  if (!nivel) redirect("/");

  const [stock, bandeja, carbonilleros, sync] = await Promise.all([
    traerElStock(supabase),
    traerBandeja(supabase),
    traerCarbonilleros(supabase),
    ultimaSincronizacionDe(supabase, "calidad", "carbonilla-odoo"),
  ]);

  return (
    <StockClient
      puedeEditar={nivel === "edicion" || nivel === "admin"}
      esAdmin={nivel === "admin"}
      saldos={stock.saldos}
      ultimaFecha={stock.ultimaFecha}
      ultimoConsumo={stock.ultimoConsumo}
      // El saldo corrido se calcula acá y no en el cliente: es una pasada sobre
      // todo el libro, y el libro arranca con veinte meses importados.
      libro={saldoCorrido(stock.movimientos).slice(-120)}
      carbonilleros={carbonilleros.filter((c) => c.activo)}
      bandeja={bandeja}
      sincronizacion={sync}
    />
  );
}
```

`ultimaSincronizacionDe(supabase, modulo, recurso)` ya existe en `lib/core/sincronizaciones.ts` y devuelve `null` —nunca lanza— si nunca corrió o si la consulta falla. El cartel dice *"sin sincronizar todavía"*, que es preferible a voltear la pantalla por un dato accesorio.

- [ ] **Paso 2: El cliente**

De arriba hacia abajo:

1. **Los dos saldos en grande**, vegetal y residual, con el total al lado y, debajo en letra chica, *"último movimiento: 14/09"* y *"última sincronización: hoy 05:00"*. Si la sincronización falló, ahí va lo que dijo Odoo **sin traducir**.
2. **Un botón grande: Cargar consumo del día.** Tipo y toneladas, nada más. Al lado, *"el último consumo vegetal cargado es del …"*. Es el aviso que sirve; no pongas un cartel rojo, porque hay 32 días al año sin consumo y un cartel que grita todos los días deja de leerse.
3. **Contar stock** y **Cargar ajuste**, más chicos.
4. **La bandeja, sólo si tiene algo.** Una fila por línea con el motivo, y dos accesos directos: *declarar este carbonillero* y *resolver este producto*. 361 días al año esta sección no existe.
5. **El libro del mes**, con `saldoCorrido`: fecha, tipo, proveedor o concepto, toneladas con su signo, saldo y origen. El origen como etiqueta: `Odoo`, `Balanza`, `A mano`, `Importado`.
6. Si un movimiento tiene `sheets_pendiente`, mostralo en su fila con el texto de Google y un botón de reintentar.

- [ ] **Paso 3: Verificar y commitear**

```bash
npx tsc --noEmit
git add "app/(app)/calidad/page.tsx" "app/(app)/calidad/StockClient.tsx"
git commit -m "feat(calidad): la pantalla del stock, con el consumo del dia adelante"
```

---

## Tarea 17: El libro completo

**Archivos:**
- Crear: `app/(app)/calidad/movimientos/page.tsx`
- Crear: `app/(app)/calidad/movimientos/MovimientosClient.tsx`

- [ ] **Paso 1: El Server Component**

`app/(app)/calidad/movimientos/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelCalidadDe } from "@/lib/calidad/auth";
import { traerMovimientos, traerCarbonilleros, saldoCorrido } from "@/lib/calidad/consultas";
import MovimientosClient from "./MovimientosClient";

/**
 * El libro entero, con filtros. Acá —y sólo acá— se ven los `sin_separar`.
 *
 * El saldo corrido se calcula sobre TODO el libro y recién después se filtra:
 * el saldo de una fila es lo que había después de ella, y filtrar antes daría
 * un saldo que empieza en cero a mitad de año.
 */
export default async function MovimientosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelCalidadDe(supabase, user.id);
  if (!nivel) redirect("/");

  const [movimientos, carbonilleros] = await Promise.all([
    traerMovimientos(supabase),
    traerCarbonilleros(supabase),
  ]);

  return (
    <MovimientosClient
      puedeEditar={nivel === "edicion" || nivel === "admin"}
      libro={saldoCorrido(movimientos)}
      carbonilleros={carbonilleros}
    />
  );
}
```

- [ ] **Paso 2: El cliente**

Filtros por mes, tipo, carbón y origen, con la URL como estado — usá
`lib/core/filtrosUrl.ts` y `lib/core/usarLaUrl.ts`, que ya lo resuelven en
Despacho y Compras; no escribas un manejo de estado nuevo.

Columnas: fecha, tipo, proveedor o concepto, toneladas **con su signo**, saldo
vegetal, saldo residual, saldo total, origen y motivo. Corregir un movimiento
abre el `PATCH` de la tarea 13.

**Los `sin_separar` se muestran acá y en ningún otro lado**, con una etiqueta al
lado de la fila: *"antes del 15/12/2025 el libro no separaba vegetal de
residual"*. Y con los saldos de esas filas **en blanco**, no en cero: un cero se
lee como "no había carbón" y lo que pasa es que no se sabe. Que alguien los vea
y entienda por qué no suman es la mitad del trabajo de haberlos importado.

- [ ] **Paso 3: Verificar y commitear**

```bash
npx tsc --noEmit
git add "app/(app)/calidad/movimientos/page.tsx" "app/(app)/calidad/movimientos/MovimientosClient.tsx"
git commit -m "feat(calidad): el libro entero, con los sin_separar visibles y sin saldo"
```

---

## Tarea 18: Los dos catálogos en pantalla

**Archivos:**
- Crear: `app/(app)/calidad/carbonilleros/page.tsx` y su cliente
- Crear: `app/(app)/calidad/productos/page.tsx` y su cliente

- [ ] **Paso 1: El Server Component de Carbonilleros**

`app/(app)/calidad/carbonilleros/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { esAdminCalidad } from "@/lib/calidad/auth";
import { traerCarbonilleros, traerBandeja } from "@/lib/calidad/consultas";
import { traerTodo } from "@/lib/core/paginado";
import CarbonillerosClient from "./CarbonillerosClient";

/**
 * Qué proveedor de Odoo es carbonillero, y de qué tipo.
 *
 * ES EL ÚNICO LUGAR DONDE SE DICE EL TIPO DE CARBÓN, porque no se puede deducir
 * de ningún lado: Membranex —el único residual— usa el mismo producto que los
 * vegetales 6 veces al año.
 */
export default async function CarbonillerosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await esAdminCalidad(supabase, user.id))) redirect("/calidad");

  const [carbonilleros, bandeja, empresas, proveedores] = await Promise.all([
    traerCarbonilleros(supabase),
    traerBandeja(supabase),
    supabase.from("empresas").select("id, nombre").order("nombre"),
    traerTodo<{ id: string; nombre: string; cuit: string | null }>((desde, hasta) =>
      supabase.from("proveedores").select("id, nombre, cuit").order("nombre").range(desde, hasta)
    ),
  ]);

  // Los partners que aparecieron en la bandeja sin estar declarados: se dan de
  // alta desde acá, sin ir a buscar el id a Odoo.
  const declarados = new Set(carbonilleros.map((c) => c.odoo_partner_id));
  const sinDeclarar = [
    ...new Map(
      bandeja
        .filter((l) => !declarados.has(l.odoo_partner_id))
        .map((l) => [l.odoo_partner_id, { id: l.odoo_partner_id, nombre: l.odoo_partner_nombre }])
    ).values(),
  ];

  return (
    <CarbonillerosClient
      carbonilleros={carbonilleros}
      sinDeclarar={sinDeclarar}
      empresas={empresas.data ?? []}
      proveedores={proveedores}
    />
  );
}
```

- [ ] **Paso 2: El cliente de Carbonilleros**

Una tabla con: nombre de planilla, código de planilla, partner de Odoo (con el
id a la vista), empresa, tipo de carbón, activo, y una columna **"En el
núcleo"** que diga `sí` o `falta`.

Esa columna es la deuda que el diseño decidió **dejar a la vista en vez de
tapar**: al 16/09/2026, seis de los diez carbonilleros no tienen CUIT en el SdG
y `LA INVENCIBLE` —cinco camiones en septiembre— no existe en el catálogo. El
stock funciona igual; lo que no funciona sin eso es cruzar ese carbón con
Compras y Facturación.

Arriba, si `sinDeclarar` tiene algo: *"Estos proveedores trajeron carbonilla y
no están declarados"*, con un botón por cada uno que abre el alta con el
`odoo_partner_id` y el nombre ya puestos.

- [ ] **Paso 3: Productos**

`app/(app)/calidad/productos/page.tsx` y su cliente, con la misma forma:
`esAdminCalidad`, la lista blanca, y arriba los `odoo_product_id` que están en la
bandeja sin resolver, cada uno con dos botones: **cuenta como carbonilla** y
**no cuenta**.

**El id va al lado del nombre, siempre y en todas las filas.** En esta base
`CARBONILLA` (6909) y `CARBONILLA ` (4419) se ven idénticos en un desplegable:
difieren en un espacio al final. Elegir el que no es no rompe nada y ensucia el
stock para siempre.

- [ ] **Paso 4: Verificar y commitear**

```bash
npx tsc --noEmit
git add "app/(app)/calidad/carbonilleros/page.tsx" "app/(app)/calidad/carbonilleros/CarbonillerosClient.tsx" "app/(app)/calidad/productos/page.tsx" "app/(app)/calidad/productos/ProductosClient.tsx"
git commit -m "feat(calidad): los dos catalogos, con la deuda con el nucleo a la vista"
```

---

## Tarea 19: El módulo entra al menú

**Archivos:**
- Modificar: `lib/core/nav.ts`

**Recién ahora**, con las cuatro pantallas construidas.

- [ ] **Paso 1: Agregar el grupo**

Después del bloque de `Cantera`:

```ts
{
  label: "Calidad",
  href: "/calidad",
  modulo: "calidad",
  // El stock primero: es la pantalla que se abre a la tarde para cargar el
  // consumo del día, que es lo que se hace 224 de 256 días. El libro entero y
  // los catálogos se miran después, no durante.
  children: [
    { label: "El stock", href: "/calidad", modulo: "calidad" },
    { label: "Movimientos", href: "/calidad/movimientos", modulo: "calidad" },
    { label: "Carbonilleros", href: "/calidad/carbonilleros", modulo: "calidad", soloAdmin: true },
    { label: "Productos", href: "/calidad/productos", modulo: "calidad", soloAdmin: true },
  ],
},
```

- [ ] **Paso 2: Verificar y commitear**

```bash
npm test
npx tsc --noEmit
git add lib/core/nav.ts
git commit -m "feat(calidad): el modulo entra al menu"
```

---

# Parte 7 — La importación

## Tarea 20: De un renglón de la planilla a un movimiento

**Archivos:**
- Crear: `lib/calidad/importar.ts`
- Test: `lib/calidad/importar.test.ts`

- [ ] **Paso 1: Escribir el test que falla**

`lib/calidad/importar.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { movimientoDesdeElRenglon, type CatalogoDeLaPlanilla } from "./importar";

const CATALOGO: CatalogoDeLaPlanilla = new Map([
  ["00003", { id: "c-bruzzone", carbon: "vegetal" as const }],
  ["00010", { id: "c-membranex", carbon: "residual" as const }],
]);

// CODIGO, DESCRIPCION, ENTRADAS, SALIDAS, TOTAL, VEGETAL, RESIDUAL, FECHA, STOCK FISICO, ERROR
const renglon = (celdas: unknown[]) => celdas;

describe("movimientoDesdeElRenglon", () => {
  it("una entrada después del corte lleva el tipo de su carbonillero", () => {
    const r = movimientoDesdeElRenglon(
      renglon(["00003", "BRUZZONE JUAN ALBERTO", 20.58, "", 288.9, 238.4, 50.02, 46276]),
      42,
      CATALOGO
    );
    expect(r).toMatchObject({
      clase: "movimiento",
      movimiento: {
        fecha: "2026-09-11", tipo: "entrada", carbon: "vegetal",
        toneladas: 20.58, carbonillero_id: "c-bruzzone",
        origen: "importacion", sheets_fila: 42,
      },
    });
  });

  it("una entrada ANTES del corte va sin_separar, aunque el carbonillero tenga tipo", () => {
    // 45895 = 2025-08-26. El libro no separaba todavía.
    const r = movimientoDesdeElRenglon(
      renglon(["00003", "BRUZZONE JUAN ALBERTO", 23.86, "", 23.86, "", "", 45895]),
      3,
      CATALOGO
    );
    expect(r).toMatchObject({ clase: "movimiento", movimiento: { carbon: "sin_separar" } });
  });

  it("un CONSUMO VEGETAL es un consumo, con el signo dado vuelta", () => {
    const r = movimientoDesdeElRenglon(
      renglon(["00015", "CONSUMO VEGETAL", "", 37, 324.9, 248.8, 75.6, 46277]),
      50,
      CATALOGO
    );
    expect(r).toMatchObject({
      clase: "movimiento",
      movimiento: { tipo: "consumo", carbon: "vegetal", toneladas: -37 },
    });
  });

  it("un CONSUMO a secas va sin_separar: el libro no distinguía", () => {
    // 45930 = 2025-09-30, era 2. El código 00001 murió el 20/11/2025.
    const r = movimientoDesdeElRenglon(
      renglon(["00001", "CONSUMO", "", 46, 300, "", "", 45930]),
      120,
      CATALOGO
    );
    expect(r).toMatchObject({ clase: "movimiento", movimiento: { carbon: "sin_separar" } });
  });

  it("una fila con texto en STOCK FISICO es un ajuste con ese texto de motivo", () => {
    const r = movimientoDesdeElRenglon(
      renglon(["00015", "CONSUMO VEGETAL", "", 46, 759.81, 331.67, 427.69, 46132, "AJUSTE DE STOCK (-46 Tn.)"]),
      661,
      CATALOGO
    );
    expect(r).toMatchObject({
      clase: "movimiento",
      movimiento: { tipo: "ajuste", toneladas: -46, motivo: "AJUSTE DE STOCK (-46 Tn.)" },
    });
  });

  it("una fila sin fecha se informa y no se importa", () => {
    const r = movimientoDesdeElRenglon(
      renglon(["00010", "MEMBRANEX CARBON RESIDUAL", 25.62, "", 355.85, 279.76, 75.64]),
      1034,
      CATALOGO
    );
    expect(r.clase).toBe("sin_importar");
  });

  it("un código que no está en el catálogo se informa y no se enlaza al que se le parece", () => {
    const r = movimientoDesdeElRenglon(
      renglon(["00018", "EL INVENCIBLE", 17.26, "", 273.5, 223.06, 50.02, 46275]),
      1033,
      CATALOGO
    );
    expect(r.clase).toBe("sin_importar");
    if (r.clase !== "sin_importar") throw new Error("no informó");
    expect(r.motivo).toContain("00018");
  });

  it("una fila vacía se saltea sin ruido", () => {
    expect(movimientoDesdeElRenglon(renglon(["", " "]), 1200, CATALOGO).clase).toBe("vacia");
  });

  it("un conteo físico numérico sale aparte del movimiento", () => {
    const r = movimientoDesdeElRenglon(
      renglon(["00015", "CONSUMO VEGETAL", "", 29, 326.85, 250.75, 75.64, 46276, 298, -28.857]),
      1035,
      CATALOGO
    );
    expect(r.clase).toBe("movimiento");
    if (r.clase !== "movimiento") throw new Error("no es movimiento");
    expect(r.conteo).toEqual({ toneladas_contadas: 298, carbon: "vegetal", fecha: "2026-09-11" });
  });
});
```

- [ ] **Paso 2: Correr y verificar que falla**

```bash
npx vitest run lib/calidad/importar.test.ts
```

Esperado: FAIL, `Failed to resolve import "./importar"`.

- [ ] **Paso 3: Implementar**

`lib/calidad/importar.ts`. Las reglas, en orden:

1. Fila vacía (`CODIGO` y `DESCRIPCION` en blanco) → `{ clase: "vacia" }`.
2. `fechaDeSheets(celdas[7])` nulo → `{ clase: "sin_importar", motivo: "sin fecha" }`. Hay **una** fila así en 1.043.
3. `STOCK FISICO` con texto no numérico → el movimiento es un **ajuste** con ese texto de motivo, y el signo sale de en qué columna está la cantidad. Son **3** filas.
4. `STOCK FISICO` numérico → además del movimiento, sale un `conteo`.
5. Código `00015`/`00016`/`00001` → consumo. `00001` fuerza `sin_separar`.
6. Cualquier otro código → entrada, con el carbonillero del catálogo; si no está, `sin_importar` con el código en el motivo. **No se enlaza al que se le parece.**
7. Si la fecha es anterior a `CORTE_DE_LOS_TIPOS`, el `carbon` es `sin_separar` **siempre**, pase lo que pase con el catálogo.
8. Todo lleva `origen: "importacion"` y `sheets_fila` con el número de fila real.

- [ ] **Paso 4: Correr, verificar y commitear**

```bash
npx vitest run lib/calidad/importar.test.ts
```

Esperado: 9 tests en verde.

```bash
git add lib/calidad/importar.ts lib/calidad/importar.test.ts
git commit -m "feat(calidad): de un renglon de la planilla vieja a un movimiento, con sus tres eras"
```

---

## Tarea 21: El script de importación

**Archivos:**
- Crear: `scripts/importar-stock-carbonilla.mts`

Corre una sola vez, con `npx tsx`. Lee `.env.local` como los otros scripts del repo.

**CORRE ANTES QUE LA SINCRONIZACIÓN, Y NO AL REVÉS.** Se midió el 16/09/2026: la
sincronización real leyó 45 líneas de Odoo y escribió **cero**, porque el cron
nunca mira antes de `CALIDAD_DESDE` y Odoo está once días atrasado. El orden es
el único que no pierde ni duplica nada: primero la importación trae de la
planilla **todo hasta el día anterior** —incluidos los 21 camiones que Odoo
todavía no tiene—, `CALIDAD_DESDE` queda en el día de esa corrida, y de ahí en
más se ocupa el cron.

Adelantar el corte para que la sincronización "haga algo" antes de importar deja
a esos camiones fuera de los dos lados: unas 400 toneladas.

- [ ] **Paso 1: Escribirlo**

Hace, en orden:

1. Leer `Entradas  Salidas` con `leerValores(..., { sinFormato: true })`.
2. Leer `Listado articulos GRAL` para armar el catálogo `código → carbonillero`. Los códigos que no tengan carbonillero declarado en el SdG se **listan y no se inventan**.
3. Por cada renglón, `movimientoDesdeElRenglon`. Acumular tres listas: movimientos, conteos y `sin_importar`.
4. **Los dos ajustes del saldo inicial**, con fecha `2025-12-15` y motivo `"saldo inicial según la planilla al 15/12/2025"`: `+208` vegetal y `+169` residual. Salen de la primera fila del libro que tiene las dos columnas con número; el script los **calcula de la planilla**, no los trae cableados, y los imprime para que se verifiquen antes de escribir.
5. **Un `--secar` que no escribe nada** y sólo imprime el informe. Correrlo primero, siempre.
6. Escribir en lotes (`upsert` de a 500), con `origen: "importacion"`.
7. **La conciliación contra Odoo, como verificación y sin enlazar nada**: por cada entrada, buscar una línea de Odoo del mismo carbonillero con fecha a ±2 días, y contar cuántas coinciden exactamente, cuántas difieren y cuántas no tienen orden. Medido el 15/09/2026: **515 coinciden, 60 difieren, 37 sin orden**. Si tu corrida da muy distinto, algo cambió y hay que mirarlo antes de seguir.

- [ ] **Paso 2: Correr en seco y mostrar el informe**

```bash
npx tsx scripts/importar-stock-carbonilla.mts --secar
```

Esperado: ~1.043 renglones leídos, el saldo recalculado al 15/09 **cerca pero no igual** al de la planilla, y la lista de los `sin_importar`. **Mostrale el informe al usuario y esperá su visto bueno antes de escribir.**

- [ ] **Paso 3: Correrlo de verdad, commitear el script**

```bash
npx tsx scripts/importar-stock-carbonilla.mts
git add scripts/importar-stock-carbonilla.mts
git commit -m "feat(calidad): la importacion de los veinte meses, con su conciliacion contra Odoo"
```

---

# Parte 8 — Cierre

## Tarea 22: Que la recepción de Despacho alimente el libro

**Archivos:**
- Modificar: `lib/despacho/pushRecepcion.ts`

**Ésta es la tarea que cierra el circuito**, y es corta porque el diseño la hizo corta.

- [ ] **Paso 1: Leer de vuelta el id de la línea**

Después de crear la orden en Odoo, `pushRecepcion` ya tiene el `purchase.order` id. Sumar una lectura de su línea:

```ts
const lineas = await buscarLeer<{ id: number }>(
  "purchase.order.line",
  [["order_id", "=", odooPurchaseOrderId]],
  ["id"],
  { limite: 1 }
);
const odooPurchaseLineId = lineas[0]?.id ?? null;
```

- [ ] **Paso 2: Guardar el movimiento de Calidad**

Con `origen: "recepcion"`, `despacho_recepcion_id` y ese `odoo_purchase_line_id`. **Ése es todo el mecanismo anti-duplicado**: cuando el cron pase por la misma línea, el `ON CONFLICT` la frena. No hay que cruzar por fecha, proveedor y cantidad — que es el cruce que en la planilla vieja se corrió un camión tres días seguidos en noviembre.

Si el carbonillero de esa recepción no está declarado en `calidad_carbonilleros`, **no se inventa**: el movimiento no se crea y la recepción se cierra igual, dejando la línea en la bandeja para la próxima corrida del cron. Cerrar la recepción es lo urgente —hay un camión afuera—; el stock espera.

- [ ] **Paso 3: Verificar y commitear**

```bash
npm test
npx tsc --noEmit
git add lib/despacho/pushRecepcion.ts
git commit -m "feat(calidad): la recepcion de Despacho escribe el movimiento, y el cron no lo duplica"
```

---

## Tarea 23: La documentación

**Archivos:**
- Crear: `docs/CALIDAD.md`
- Modificar: `CLAUDE.md`
- Modificar: `docs/VARIABLES-VERCEL.md`
- Modificar: `docs/DESPACHO.md`

- [ ] **Paso 1: `docs/CALIDAD.md`**

Las decisiones y las trampas que no se deducen del código, con el mismo formato que `docs/PRODUCCION.md`: qué reemplaza, por qué el signo va guardado, por qué `sin_separar` existe y por qué no suma, por qué el carbonillero se identifica por el partner de Odoo, por qué la ventana va por `create_date`, y la tabla de "dónde vive cada cosa".

Anotá también lo que quedó pendiente: **el `.in()` de `sincronizar.ts` está cortado en 200 ids**, y si alguna vez hay más líneas en la ventana de 30 días hay que hacerlo por lotes — un `.in()` largo arma una URL que PostgREST rechaza con un 400 sin decir por qué.

- [ ] **Paso 2: `CLAUDE.md`**

- Sumar Calidad a la lista de módulos del encabezado: pasan a ser **nueve**, y Cantera también falta ahí.
- Sumar la fila a la tabla de "antes de retomar un módulo, leer su documento".
- En la sección de las planillas de Google, sumar Calidad a las que **manda el sistema**, junto con Producción y las órdenes de carga, y anotar que es la primera que **pisa fórmulas a propósito**, con las tres razones.

- [ ] **Paso 3: `docs/VARIABLES-VERCEL.md`**

```
| `GOOGLE_SHEETS_STOCK_CARBONILLA_ID` | La planilla de stock de carbonilla: `1m9DwAcPZ5OpEv5edk97ZtmeHNcOG2d4riVDk_XM4EKI`. Espejo de una sola vía: sin la variable el movimiento se guarda igual y queda con `sheets_pendiente`. **La cuenta de servicio necesita EDITOR**, no lectura | El tramo entre `/d/` y `/edit` de la URL |
| `CALIDAD_DESDE` | El día en que corrió la importación. El cron no mira órdenes anteriores: es lo que evita que el histórico se duplique | `YYYY-MM-DD` |
```

- [ ] **Paso 4: `docs/DESPACHO.md`**

Anotar que cerrar una recepción ahora también escribe el movimiento de stock de Calidad, y que por eso guarda el id de la línea de Odoo.

- [ ] **Paso 5: Commitear**

```bash
git add docs/CALIDAD.md CLAUDE.md docs/VARIABLES-VERCEL.md docs/DESPACHO.md
git commit -m "docs(calidad): el documento del modulo y las variables nuevas"
```

---

## Tarea 24: La verificación que atrapa lo que las otras no

- [ ] **Paso 1: Las cuatro**

```bash
npm test
npx tsc --noEmit
npm run build
node scripts/revisar-arbol-commiteado.mjs
```

El `build` **no** se corre con `npm run dev` levantado: deja la app en 500. Pará el dev server antes.

El último es el que importa: los otros tres miran **el disco** y Vercel construye **el árbol commiteado**. En este repo se commitea con rutas explícitas, así que un archivo nuevo que quedó *staged* y nunca se commiteó no viaja mientras los que lo importan sí — y nada avisa. Eso tiró cuatro deploys seguidos el 14/09/2026 con un `Module not found` que el build local no podía reproducir. Con un módulo entero de archivos nuevos, es la verificación que más chances tiene de encontrar algo.

- [ ] **Paso 2: Pushear**

```bash
git push
```

- [ ] **Paso 3: Decirle al usuario lo que falta de una persona**

Con esta lista, textual:

1. **Permiso de EDITOR** para la cuenta de servicio sobre la planilla de stock. Hoy está compartida como lectora y el espejo escribe.
2. `GOOGLE_SHEETS_STOCK_CARBONILLA_ID` y `CALIDAD_DESDE` en Vercel.
3. ~~Declarar los carbonilleros~~ — **hecho el 16/09/2026**: 13 cargados, uno por partner de Odoo con órdenes en el último año.
4. ~~Resolver la lista blanca~~ — **hecho el 16/09/2026**: 10 productos, los tres fletes en `cuenta = false`.
5. Agregar `AJUSTE VEGETAL` (`00019`) y `AJUSTE RESIDUAL` (`00020`) a `Listado articulos GRAL`.
6. **Los once días de Odoo sin cargar**: los 21 camiones del 04 al 15/09 que están en la planilla y no en Odoo. Y decidir cuál de los dos Bruzzone de 19,58 del 04/09 es el bueno — está duplicado en la planilla.

Hasta que 1 a 4 estén hechos, **el módulo no va a mostrar un solo camión**: no es un error, es el catálogo vacío.
