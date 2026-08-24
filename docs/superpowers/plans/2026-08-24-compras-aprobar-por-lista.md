# Aprobar por lista y la bandeja "Para aprobar" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que aprobar dependa de estar en `compras_aprobadores` —hoy NICO y MAXI— y no del nivel de acceso, y darles una bandeja donde resolver las compras que esperan su decisión.

**Architecture:** El permiso se muda del nivel a la lista, en los dos lados: `puedeAprobarCompras()` en TypeScript y `puede_aprobar_compras()` en RLS. La lista pasa a administrarse desde `/compras/configuracion` con alta y baja, y el alias deja de ser obligatorio. La bandeja es una pantalla nueva que reusa `ComparativaDecision`, la vista de decisión que ya existe.

**Tech Stack:** Next.js 16 (App Router, Server Components), Supabase/Postgres con RLS, vitest.

**Spec:** [docs/superpowers/specs/2026-08-24-compras-aprobar-por-lista-design.md](../specs/2026-08-24-compras-aprobar-por-lista-design.md)

---

## Estructura de archivos

**Crear:**
| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/028_compras_aprobar_por_lista.sql` | alias opcional, RLS por lista, quién administra la lista |
| `lib/compras/bandeja.ts` | lógica pura: repartir la bandeja y la regla de no vaciar la lista |
| `lib/compras/bandeja.test.ts` | sus tests |
| `app/(app)/compras/para-aprobar/page.tsx` | carga los datos de la bandeja |
| `app/(app)/compras/para-aprobar/BandejaClient.tsx` | los dos bloques, con la comparativa desplegable |

**Modificar:**
| Archivo | Cambio |
|---|---|
| `lib/compras/auth.ts` | `puedeAprobarCompras()` y `aprobadoresDeCompras()` salen de la lista; se suma `esAdminCompras()` |
| `app/api/compras/aprobadores/route.ts` | alta y baja además del alias; baja del último rechazada |
| `app/(app)/compras/configuracion/ConfiguracionClient.tsx` | administrar la lista |
| `app/api/compras/cotizaciones/[id]/elegir/route.ts` | exigir también estar en la lista |
| `lib/core/nav.ts` | `soloAprobadorCompras`, ítem nuevo, y `puedeVerItem()` compartido |
| `components/Sidebar.tsx` | usa `puedeVerItem()` y recibe `esAprobadorCompras` |
| `app/(app)/layout.tsx` | calcula `esAprobadorCompras` |
| `lib/core/nav-compras.test.ts` | usa `puedeVerItem()` en vez de duplicarlo |
| `docs/COMPRAS.md` | la tabla de permisos |

---

## Tarea 1: La migración

**Files:**
- Create: `supabase/migrations/028_compras_aprobar_por_lista.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- ============================================================
-- SdG — Compras: aprobar es estar en una lista, no tener un nivel
--
-- Hasta acá `puede_aprobar_compras()` miraba `usuario_modulos.nivel = 'admin'`,
-- así que quien administraba el módulo también decidía sobre el gasto. Son dos
-- cosas distintas y las hacen personas distintas: administrar es configurar,
-- aprobar es autorizar plata.
--
-- El permiso se muda a `compras_aprobadores`, que ya existía para guardar el
-- alias con el que cada uno figura en la planilla. Ahora esa lista ES el
-- permiso, que además es como funciona la planilla: su columna de aprobación
-- está restringida a ciertas cuentas.
-- ============================================================

-- El alias deja de ser obligatorio: pertenecer a la lista es el permiso, el
-- alias es cómo se lo nombra en la planilla. Sin alias se aprueba igual y la
-- aprobación queda pendiente de escribirse allá, que es lo que ya pasaba.
alter table compras_aprobadores alter column alias_planilla drop not null;

alter table compras_aprobadores drop constraint if exists alias_no_vacio;
alter table compras_aprobadores add constraint alias_no_vacio
  check (alias_planilla is null or btrim(alias_planilla) <> '');

create or replace function public.puede_aprobar_compras()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from compras_aprobadores where usuario_id = auth.uid()
  )
$$;

comment on function public.puede_aprobar_compras() is
  'Espeja la protección "APROBACIÓN DE GERENCIA" de la planilla: sólo quienes '
  'están en compras_aprobadores. A propósito NO incluye es_admin() ni el nivel '
  'del módulo — administrar y aprobar son cosas separadas.';

-- ── Quién administra la lista ────────────────────────────────
-- Administrar la lista sí es tarea de administración, y por eso NO alcanza con
-- estar en ella: si no, cualquier aprobador podría sacar a los demás.
drop policy if exists compras_aprobadores_write on compras_aprobadores;
create policy compras_aprobadores_write on compras_aprobadores
  for all to authenticated
  using (
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid() and modulo = 'compras' and nivel = 'admin'
    )
  )
  with check (
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid() and modulo = 'compras' and nivel = 'admin'
    )
  );
```

- [ ] **Step 2: Verificar que la lista tiene a quien corresponde ANTES de aplicar**

Si la lista estuviera vacía, al aplicar la migración nadie podría aprobar nada.

```bash
node -e "const fs=require('fs');const e=Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]));const b=e.NEXT_PUBLIC_SUPABASE_URL.replace(/\/rest\/v1\/?$/,'');fetch(b+'/rest/v1/compras_aprobadores?select=usuario_id,alias_planilla',{headers:{apikey:e.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+e.SUPABASE_SERVICE_ROLE_KEY}}).then(r=>r.json()).then(l=>console.log('en la lista:',JSON.stringify(l)))"
```

Esperado: dos filas, con alias `NICO` y `MAXI`. Si viene vacía, **parar** y avisar.

- [ ] **Step 3: Aplicar la migración**

La aplica el usuario en el SQL Editor de Supabase, como las anteriores. Pedírselo y esperar confirmación.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/028_compras_aprobar_por_lista.sql
git commit -m "feat(compras): aprobar depende de la lista, no del nivel"
```

---

## Tarea 2: Los permisos en TypeScript

**Files:**
- Modify: `lib/compras/auth.ts`

- [ ] **Step 1: Reemplazar `puedeAprobarCompras`**

Buscar la función actual —la que consulta `usuario_modulos` con `.eq("nivel", "admin")`— y reemplazarla, comentario incluido:

```ts
/**
 * Aprobar es estar en la lista, no tener un nivel.
 *
 * A diferencia del resto, acá NO alcanza con ser admin del sistema ni admin del
 * módulo: la planilla restringe la columna de aprobación a ciertas cuentas y la
 * app espeja esa misma regla. Administrar el módulo y autorizar un gasto son
 * cosas distintas, y las hacen personas distintas.
 */
export async function puedeAprobarCompras(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("compras_aprobadores")
    .select("usuario_id")
    .eq("usuario_id", userId)
    .maybeSingle();

  return Boolean(data);
}

/** Administrar el módulo: entre otras cosas, quién está en la lista. */
export async function esAdminCompras(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  return (await nivelComprasDe(supabase, userId)) === "admin";
}
```

- [ ] **Step 2: Reemplazar `aprobadoresDeCompras`**

```ts
/** Quiénes pueden aprobar. Es la misma fuente que el permiso. */
export interface Aprobador {
  id: string;
  nombre: string;
  apellido: string;
  email: string;
  alias: string | null;
}

export async function aprobadoresDeCompras(supabase: SupabaseClient): Promise<Aprobador[]> {
  const { data } = await supabase
    .from("compras_aprobadores")
    .select("alias_planilla, usuarios(id, nombre, apellido, email, activo)");

  return (data ?? [])
    .map((fila) => ({
      alias: fila.alias_planilla as string | null,
      usuario: fila.usuarios as unknown as
        | { id: string; nombre: string; apellido: string; email: string; activo: boolean }
        | null,
    }))
    .filter((f): f is { alias: string | null; usuario: NonNullable<typeof f.usuario> } =>
      Boolean(f.usuario?.activo)
    )
    .map(({ alias, usuario }) => ({
      id: usuario.id,
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      email: usuario.email,
      alias,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}
```

- [ ] **Step 3: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin errores. Si alguna pantalla se queja de que `Aprobador` ahora trae `alias`, es un campo de más y no rompe.

- [ ] **Step 4: Commit**

```bash
git add lib/compras/auth.ts
git commit -m "feat(compras): el permiso de aprobar sale de la lista"
```

---

## Tarea 3: Exigir la lista también al elegir un presupuesto

La ruta que aprueba la compra hoy sólo comprueba que seas el asignado. Si alguien quedó asignado y después salió de la lista, podría aprobar igual.

**Files:**
- Modify: `app/api/compras/cotizaciones/[id]/elegir/route.ts`

- [ ] **Step 1: Agregar la comprobación**

Después del bloque que verifica `ri.compra_asignada_a !== user.id`, agregar:

```ts
  // Estar asignado no alcanza: hay que seguir estando en la lista. Alguien
  // pudo quedar asignado y después salir de ella.
  if (!(await puedeAprobarCompras(supabase, user.id))) {
    return NextResponse.json(
      { error: "Aprobar una compra requiere estar en la lista de aprobadores" },
      { status: 403 }
    );
  }
```

Y agregar el import:

```ts
import { puedeAprobarCompras } from "@/lib/compras/auth";
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add "app/api/compras/cotizaciones/[id]/elegir/route.ts"
git commit -m "fix(compras): aprobar la compra exige estar asignado y en la lista"
```

---

## Tarea 4: La regla de no vaciar la lista (TDD)

**Files:**
- Create: `lib/compras/bandeja.ts`
- Create: `lib/compras/bandeja.test.ts`

- [ ] **Step 1: Escribir el test**

```ts
import { describe, it, expect } from "vitest";
import { puedeQuitarDeLaLista } from "./bandeja";

/**
 * Sin nadie en la lista no se aprueba nada y el circuito se traba entero: ni
 * los requerimientos pasan a comparativa ni las compras se aprueban. Sacar al
 * ultimo se rechaza con un motivo, no con un error generico.
 */
describe("quitar a alguien de la lista de aprobadores", () => {
  it("con dos o mas, se puede", () => {
    expect(puedeQuitarDeLaLista(2)).toEqual({ ok: true });
  });

  it("al ultimo no", () => {
    const r = puedeQuitarDeLaLista(1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain("sin nadie");
  });

  it("una lista ya vacia tampoco deja quitar", () => {
    expect(puedeQuitarDeLaLista(0).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run lib/compras/bandeja.test.ts`
Expected: FAIL — `Failed to resolve import "./bandeja"`

- [ ] **Step 3: Escribir la función**

```ts
/**
 * La bandeja de aprobación y las reglas de la lista de aprobadores.
 *
 * Todo lo que se puede decidir sin consultar la base vive acá, para poder
 * testearlo sin credenciales.
 */

export type Permitido = { ok: true } | { ok: false; motivo: string };

/**
 * Sin nadie en la lista no se aprueba nada y el circuito se traba entero: ni
 * los requerimientos pasan a comparativa ni las compras se aprueban.
 */
export function puedeQuitarDeLaLista(cuantosHay: number): Permitido {
  if (cuantosHay > 1) return { ok: true };
  return {
    ok: false,
    motivo:
      "No se puede sacar al último de la lista: sin nadie que apruebe, " +
      "ningún requerimiento avanza y ninguna compra se aprueba.",
  };
}
```

- [ ] **Step 4: Correr el test**

Run: `npx vitest run lib/compras/bandeja.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/compras/bandeja.ts lib/compras/bandeja.test.ts
git commit -m "feat(compras): la lista de aprobadores no puede quedar vacia"
```

---

## Tarea 5: Repartir la bandeja (TDD)

**Files:**
- Modify: `lib/compras/bandeja.ts`
- Modify: `lib/compras/bandeja.test.ts`

- [ ] **Step 1: Agregar el test**

Agregar al final de `lib/compras/bandeja.test.ts`, y sumar `repartirBandeja` al import de arriba:

```ts
const ri = (nro: number, asignadoA: string | null, prioridad: "URGENTE" | "NORMAL" | null) => ({
  nro_ri: nro,
  compra_asignada_a: asignadoA,
  prioridad,
  fecha: `2026-0${nro}-01T00:00:00Z`,
  updated_at: `2026-0${nro}-01T00:00:00Z`,
});

describe("reparto de la bandeja", () => {
  const yo = "usuario-nico";
  const otro = "usuario-maxi";
  const items = [
    ri(1, otro, "URGENTE"),
    ri(2, yo, "NORMAL"),
    ri(3, yo, "URGENTE"),
    ri(4, null, null),
  ];

  it("lo asignado a quien mira va arriba", () => {
    const { mios } = repartirBandeja(items, yo);
    expect(mios.map((x) => x.nro_ri).sort()).toEqual([2, 3]);
  });

  it("el resto va abajo, incluido lo que no tiene asignado", () => {
    const { deOtros } = repartirBandeja(items, yo);
    expect(deOtros.map((x) => x.nro_ri).sort()).toEqual([1, 4]);
  });

  it("cada bloque va por urgencia y despues por antiguedad", () => {
    const { mios } = repartirBandeja(items, yo);
    expect(mios.map((x) => x.nro_ri)).toEqual([3, 2]);
  });

  it("nadie queda en los dos bloques", () => {
    const { mios, deOtros } = repartirBandeja(items, yo);
    expect(mios.length + deOtros.length).toBe(items.length);
  });
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `npx vitest run lib/compras/bandeja.test.ts`
Expected: FAIL — `repartirBandeja is not a function`

- [ ] **Step 3: Escribir la función**

Agregar a `lib/compras/bandeja.ts`, con el import arriba del archivo:

```ts
import { ordenarRequerimientos } from "@/lib/compras/constants";
import type { Prioridad } from "@/lib/compras/types";

interface EnBandeja {
  nro_ri: number;
  compra_asignada_a: string | null;
  prioridad: Prioridad | null;
  fecha: string;
  updated_at: string;
}

/**
 * Separa lo que espera la decisión de quien mira de lo que espera a otro.
 *
 * Ver la cola del otro sirve para saber si algo está demorado, y tenerla aparte
 * evita confundir "lo que tengo que hacer" con "lo que estoy esperando". Lo que
 * no tiene a nadie asignado cae abajo: no es de nadie todavía.
 */
export function repartirBandeja<T extends EnBandeja>(
  items: T[],
  usuarioId: string
): { mios: T[]; deOtros: T[] } {
  const mios = items.filter((r) => r.compra_asignada_a === usuarioId);
  const deOtros = items.filter((r) => r.compra_asignada_a !== usuarioId);

  return {
    mios: ordenarRequerimientos(mios, "prioridad"),
    deOtros: ordenarRequerimientos(deOtros, "prioridad"),
  };
}
```

- [ ] **Step 4: Correr los tests**

Run: `npx vitest run lib/compras/bandeja.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/compras/bandeja.ts lib/compras/bandeja.test.ts
git commit -m "feat(compras): el reparto de la bandeja de aprobacion"
```

---

## Tarea 6: Administrar la lista desde la API

**Files:**
- Modify: `app/api/compras/aprobadores/route.ts`

- [ ] **Step 1: Reemplazar el archivo entero**

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { esAdminCompras } from "@/lib/compras/auth";
import { puedeQuitarDeLaLista } from "@/lib/compras/bandeja";

/**
 * La lista de quiénes pueden aprobar en Compras.
 *
 * Estar en la lista ES el permiso de aprobar. El alias es aparte: es con qué
 * texto figura cada uno en el desplegable estricto de la planilla, y sin él la
 * aprobación se guarda igual pero no llega allá.
 *
 * Administrar la lista es tarea de administración, no de aprobación: si
 * alcanzara con estar en ella, cualquier aprobador podría sacar a los demás.
 */

async function guardia(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };

  if (!(await esAdminCompras(supabase, user.id))) {
    return {
      error: NextResponse.json(
        { error: "Administrar la lista de aprobadores requiere nivel de administrador del módulo" },
        { status: 403 }
      ),
    };
  }
  return { user };
}

/** Alta: sumar a alguien a la lista. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const g = await guardia(supabase);
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const usuarioId = String(body?.usuario_id ?? "").trim();
  const alias = String(body?.alias_planilla ?? "").trim();
  if (!usuarioId) return NextResponse.json({ error: "Falta el usuario" }, { status: 400 });

  const { data, error } = await createAdminClient()
    .from("compras_aprobadores")
    .upsert({ usuario_id: usuarioId, alias_planilla: alias || null }, { onConflict: "usuario_id" })
    .select("usuario_id, alias_planilla")
    .single();

  if (error) {
    // 23505 = otro aprobador ya usa ese alias
    const mensaje = error.code === "23505"
      ? "Ese alias ya lo usa otro aprobador: en la planilla no se podrían distinguir"
      : error.message;
    return NextResponse.json({ error: mensaje }, { status: 400 });
  }
  return NextResponse.json(data, { status: 201 });
}

/** Sólo el alias. Ya no da de baja: para eso está DELETE. */
export async function PUT(request: Request) {
  const supabase = await createClient();
  const g = await guardia(supabase);
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const usuarioId = String(body?.usuario_id ?? "").trim();
  const alias = String(body?.alias_planilla ?? "").trim();
  if (!usuarioId) return NextResponse.json({ error: "Falta el usuario" }, { status: 400 });

  const { data, error } = await createAdminClient()
    .from("compras_aprobadores")
    .update({ alias_planilla: alias || null })
    .eq("usuario_id", usuarioId)
    .select("usuario_id, alias_planilla")
    .single();

  if (error) {
    const mensaje = error.code === "23505"
      ? "Ese alias ya lo usa otro aprobador: en la planilla no se podrían distinguir"
      : error.message;
    return NextResponse.json({ error: mensaje }, { status: 400 });
  }
  return NextResponse.json(data);
}

/** Baja: sacar a alguien de la lista. */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const g = await guardia(supabase);
  if (g.error) return g.error;

  const usuarioId = new URL(request.url).searchParams.get("usuario_id") ?? "";
  if (!usuarioId) return NextResponse.json({ error: "Falta el usuario" }, { status: 400 });

  const admin = createAdminClient();
  const { count } = await admin
    .from("compras_aprobadores")
    .select("usuario_id", { count: "exact", head: true });

  const permitido = puedeQuitarDeLaLista(count ?? 0);
  if (!permitido.ok) return NextResponse.json({ error: permitido.motivo }, { status: 409 });

  const { error } = await admin
    .from("compras_aprobadores")
    .delete()
    .eq("usuario_id", usuarioId);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin errores en este archivo. `ConfiguracionClient.tsx` puede quejarse porque llama al PUT esperando que borre — se arregla en la Tarea 7.

- [ ] **Step 3: Commit**

```bash
git add app/api/compras/aprobadores/route.ts
git commit -m "feat(compras): alta y baja en la lista de aprobadores"
```

---

## Tarea 7: Administrar la lista desde la pantalla

**Files:**
- Modify: `app/(app)/compras/configuracion/ConfiguracionClient.tsx`
- Modify: `app/(app)/compras/configuracion/page.tsx`

- [ ] **Step 1: Leer la sección actual de aprobadores**

Run: `grep -n "aprobador\|alias" "app/(app)/compras/configuracion/ConfiguracionClient.tsx"`

Sirve para ubicar el bloque que hoy sólo edita el alias y para conocer los nombres de sus estados. El bloque se reemplaza; el resto de la pantalla no se toca.

- [ ] **Step 2: Pasar la lista de usuarios candidatos desde la página**

En `app/(app)/compras/configuracion/page.tsx`, junto a los datos que ya carga:

```tsx
  // Para poder sumar a alguien a la lista hace falta saber a quién.
  const { data: usuarios } = await supabase
    .from("usuarios")
    .select("id, nombre, apellido, email")
    .eq("activo", true)
    .order("nombre");
```

Y pasarlo al cliente: `usuarios={usuarios ?? []}`.

- [ ] **Step 3: Reemplazar el bloque de aprobadores**

En `ConfiguracionClient.tsx`, la sección de aprobadores pasa a ser:

```tsx
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Quiénes aprueban
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Estar en esta lista es el permiso de aprobar: los requerimientos y las
          compras. No depende del nivel de acceso, y ser administrador no alcanza.
        </p>

        {errorLista && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorLista}
          </div>
        )}

        <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
          {aprobadores.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm text-slate-900">{a.nombre} {a.apellido}</p>
                <p className="text-xs text-slate-400">{a.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  defaultValue={a.alias ?? ""}
                  onBlur={(e) => guardarAlias(a.id, e.target.value)}
                  placeholder="Alias en la planilla"
                  className="w-40 rounded-lg border border-slate-300 px-2 py-1 text-sm"
                />
                <button
                  onClick={() => quitar(a.id)}
                  className="text-xs text-slate-400 hover:text-red-600"
                >
                  Quitar
                </button>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-3 flex flex-wrap gap-2">
          <select
            value={aSumar}
            onChange={(e) => setASumar(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Sumar a alguien…</option>
            {usuarios
              .filter((u) => !aprobadores.some((a) => a.id === u.id))
              .map((u) => (
                <option key={u.id} value={u.id}>{u.nombre} {u.apellido}</option>
              ))}
          </select>
          <button
            onClick={sumar}
            disabled={!aSumar}
            className="rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
          >
            Sumar a la lista
          </button>
        </div>

        <p className="mt-2 text-xs text-slate-500">
          El alias es con qué texto figura cada uno en el desplegable de la
          planilla —NICO, MAXI—. Sin alias se aprueba igual, pero la aprobación
          no llega a la planilla y queda pendiente.
        </p>
      </section>
```

Y las funciones que usa, junto a los otros handlers del componente:

```tsx
  const [aSumar, setASumar] = useState("");
  const [errorLista, setErrorLista] = useState("");

  async function sumar() {
    setErrorLista("");
    const res = await fetch("/api/compras/aprobadores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario_id: aSumar }),
    });
    if (!res.ok) {
      setErrorLista((await res.json().catch(() => ({}))).error ?? "No se pudo sumar.");
      return;
    }
    setASumar("");
    router.refresh();
  }

  async function quitar(usuarioId: string) {
    setErrorLista("");
    const res = await fetch(`/api/compras/aprobadores?usuario_id=${usuarioId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      setErrorLista((await res.json().catch(() => ({}))).error ?? "No se pudo quitar.");
      return;
    }
    router.refresh();
  }

  async function guardarAlias(usuarioId: string, alias: string) {
    setErrorLista("");
    const res = await fetch("/api/compras/aprobadores", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario_id: usuarioId, alias_planilla: alias }),
    });
    if (!res.ok) {
      setErrorLista((await res.json().catch(() => ({}))).error ?? "No se pudo guardar el alias.");
      return;
    }
    router.refresh();
  }
```

Las props del componente suman `usuarios: { id: string; nombre: string; apellido: string; email: string }[]`, y `aprobadores` pasa a traer `alias: string | null`.

- [ ] **Step 4: Verificar que compila y que los tests siguen verdes**

Run: `npx tsc --noEmit && npm test`
Expected: sin errores de tipos; tests PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/compras/configuracion"
git commit -m "feat(compras): la lista de aprobadores se administra desde configuracion"
```

---

## Tarea 8: El menú (TDD)

**Files:**
- Modify: `lib/core/nav.ts`
- Modify: `lib/core/nav-compras.test.ts`
- Modify: `components/Sidebar.tsx`
- Modify: `app/(app)/layout.tsx`

- [ ] **Step 1: Escribir el test**

Reemplazar el contenido de `lib/core/nav-compras.test.ts` —que hoy duplica la lógica del Sidebar— por uno que use la función compartida:

```ts
import { describe, it, expect } from "vitest";
import { NAV, puedeVerItem, type NavItem } from "./nav";
import type { Modulo } from "./types";

const itemsDeCompras = (): NavItem[] => {
  const grupo = NAV.find((n) => n.label === "Compras");
  if (!grupo?.children) throw new Error("falta el grupo Compras");
  return grupo.children;
};

const ctx = (over: Partial<Parameters<typeof puedeVerItem>[1]> = {}) => ({
  modulos: new Set<Modulo>(["compras"]),
  adminModulos: new Set<Modulo>(),
  esAdminGlobal: false,
  esAprobadorCompras: false,
  ...over,
});

describe("menu de Compras", () => {
  it("quien tiene el modulo ve el trabajo del dia a dia", () => {
    const visibles = itemsDeCompras()
      .filter((i) => puedeVerItem(i, ctx()))
      .map((i) => i.label);
    expect(visibles).toContain("Tablero");
    expect(visibles).toContain("Requerimientos");
  });

  /**
   * Aprobar dejo de depender del nivel: administrar el modulo y autorizar un
   * gasto son cosas distintas.
   */
  it("sin estar en la lista no se ven las pantallas de aprobar, ni siendo admin", () => {
    const admin = ctx({ adminModulos: new Set<Modulo>(["compras"]), esAdminGlobal: true });
    const visibles = itemsDeCompras().filter((i) => puedeVerItem(i, admin)).map((i) => i.label);
    expect(visibles).not.toContain("Aprobaciones");
    expect(visibles).not.toContain("Para aprobar");
    // Administrar si, que es lo suyo
    expect(visibles).toContain("Configuración");
  });

  it("quien esta en la lista ve las dos, sin ser admin", () => {
    const aprobador = ctx({ esAprobadorCompras: true });
    const visibles = itemsDeCompras().filter((i) => puedeVerItem(i, aprobador)).map((i) => i.label);
    expect(visibles).toContain("Aprobaciones");
    expect(visibles).toContain("Para aprobar");
    expect(visibles).not.toContain("Configuración");
  });

  it("quien no tiene el modulo no ve nada de Compras", () => {
    const ajeno = ctx({ modulos: new Set<Modulo>(), esAprobadorCompras: true });
    expect(itemsDeCompras().filter((i) => puedeVerItem(i, ajeno))).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `npx vitest run lib/core/nav-compras.test.ts`
Expected: FAIL — `puedeVerItem` no existe.

- [ ] **Step 3: Cambiar `nav.ts`**

En la interfaz del ítem, junto a `soloAdmin`:

```ts
  /**
   * Sólo para quien está en la lista de aprobadores de Compras.
   *
   * Aprobar no depende del nivel: administrar el módulo y autorizar un gasto
   * son cosas distintas y las hacen personas distintas.
   */
  soloAprobadorCompras?: boolean;
```

Los dos ítems de Compras que cambian, y el nuevo:

```ts
      { label: "Aprobaciones", href: "/compras/aprobaciones", modulo: "compras", soloAprobadorCompras: true },
      { label: "Para aprobar", href: "/compras/para-aprobar", modulo: "compras", soloAprobadorCompras: true },
```

(`Aprobaciones` deja de tener `soloAdmin`; `Configuración` lo conserva.)

Y al final del archivo, la función que hoy vive duplicada en el Sidebar y en su test:

```ts
export interface ContextoNav {
  modulos: Set<Modulo>;
  adminModulos: Set<Modulo>;
  esAdminGlobal: boolean;
  esAprobadorCompras: boolean;
}

/**
 * Si un ítem se ve o no.
 *
 * Vive acá y no en el Sidebar porque el test lo estaba reimplementando: dos
 * copias de una regla de permisos es una copia de más.
 */
export function puedeVerItem(item: NavItem, ctx: ContextoNav): boolean {
  if (item.modulo && !ctx.modulos.has(item.modulo)) return false;
  if (item.soloAdminGlobal) return ctx.esAdminGlobal;
  if (item.soloAprobadorCompras) return ctx.esAprobadorCompras;
  if (item.soloAdmin) return item.modulo ? ctx.adminModulos.has(item.modulo) : ctx.esAdminGlobal;
  return true;
}
```

Nota: la comprobación del módulo va **primero**, para que quien no tiene Compras no vea "Para aprobar" aunque esté en la lista.

- [ ] **Step 4: Usarla en el Sidebar**

En `components/Sidebar.tsx`, borrar la función `visible()` local y usar la compartida. El componente suma la prop `esAprobadorCompras: boolean` y arma el contexto una vez:

```tsx
import { NAV, puedeVerItem, type NavItem } from "@/lib/core/nav";
```

```tsx
  const ctx = {
    modulos,
    adminModulos: new Set(modulosAdmin),
    esAdminGlobal: rol === "admin_sistema" || rol === "admin",
    esAprobadorCompras,
  };
```

Reemplazar cada llamada `visible(item, ...)` por `puedeVerItem(item, ctx)`. Si el Sidebar calculaba `esAdminGlobal` de otra forma, conservar ese cálculo y sólo mover la decisión a `puedeVerItem`.

- [ ] **Step 5: Calcularlo en el layout**

En `app/(app)/layout.tsx`, junto a `modulosAdmin`:

```tsx
  // Aprobar no depende del nivel: sale de la lista.
  const esAprobadorCompras = await puedeAprobarCompras(supabase, user.id);
```

Con el import `import { puedeAprobarCompras } from "@/lib/compras/auth";`, y pasarlo: `esAprobadorCompras={esAprobadorCompras}`.

- [ ] **Step 6: Correr los tests y verificar tipos**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, sin errores de tipos.

- [ ] **Step 7: Commit**

```bash
git add lib/core/nav.ts lib/core/nav-compras.test.ts components/Sidebar.tsx "app/(app)/layout.tsx"
git commit -m "feat(compras): el menu de aprobar se muestra por la lista, no por el nivel"
```

---

## Tarea 9: La bandeja

**Files:**
- Create: `app/(app)/compras/para-aprobar/page.tsx`
- Create: `app/(app)/compras/para-aprobar/BandejaClient.tsx`

- [ ] **Step 1: La página**

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { puedeAprobarCompras } from "@/lib/compras/auth";
import { traerTodo } from "@/lib/core/paginado";
import BandejaClient from "./BandejaClient";
import type { RequerimientoConRelaciones, Cotizacion } from "@/lib/compras/types";

export default async function ParaAprobarPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // La bandeja es de quienes aprueban: no tiene nada que mostrarle a nadie más.
  if (!(await puedeAprobarCompras(supabase, user.id))) redirect("/compras");

  const requerimientos = await traerTodo<RequerimientoConRelaciones>((desde, hasta) =>
    supabase
      .from("compras_requerimientos")
      .select("*, compras_areas(nombre), empresas(nombre), proveedores(nombre), compras_ubicaciones(nombre)")
      .eq("estado_aprobacion", "APROBADA")
      .eq("estado_compra", "PARA_COMPRAR")
      .order("fecha", { ascending: true })
      .range(desde, hasta)
  );

  // Los presupuestos de todos ellos, para poder decidir sin abrir cada ficha.
  //
  // El filtro va por el estado del requerimiento y no por una lista de ids:
  // mandar los ids arma una URL que PostgREST rechaza cuando el conjunto crece,
  // y ya nos tumbó el tablero una vez.
  const cotizaciones = (await traerTodo((desde, hasta) =>
    supabase
      .from("compras_cotizaciones")
      .select("*, proveedores(nombre), compras_requerimientos!inner(estado_compra)")
      .eq("compras_requerimientos.estado_compra", "PARA_COMPRAR")
      .order("precio_total", { ascending: true })
      .range(desde, hasta)
  )) as unknown as Cotizacion[];

  const porRequerimiento: Record<string, Cotizacion[]> = {};
  for (const c of cotizaciones) {
    (porRequerimiento[c.requerimiento_id] ??= []).push(c);
  }

  return (
    <BandejaClient
      requerimientos={requerimientos}
      cotizaciones={porRequerimiento}
      usuarioId={user.id}
    />
  );
}
```

- [ ] **Step 2: El cliente**

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { etiquetaPrioridad, fecha, diasRestantes, moneda } from "@/lib/compras/constants";
import { repartirBandeja } from "@/lib/compras/bandeja";
import ComparativaDecision from "../requerimientos/[id]/ComparativaDecision";
import type { RequerimientoConRelaciones, Cotizacion } from "@/lib/compras/types";

/**
 * La bandeja de quien aprueba compras.
 *
 * Arriba lo que espera su decisión, abajo lo que espera a otro. Cada pedido se
 * despliega con su comparativa completa, así se decide sin salir de acá: elegir
 * un presupuesto ES aprobar la compra.
 */
export default function BandejaClient({
  requerimientos, cotizaciones, usuarioId,
}: {
  requerimientos: RequerimientoConRelaciones[];
  cotizaciones: Record<string, Cotizacion[]>;
  usuarioId: string;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState<string | null>(null);
  const [eligiendo, setEligiendo] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);

  const { mios, deOtros } = repartirBandeja(requerimientos, usuarioId);

  async function elegir(c: Cotizacion) {
    setEligiendo(c.id);
    setError("");
    const res = await fetch(`/api/compras/cotizaciones/${c.id}/elegir`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setEligiendo(null);
    if (!res.ok) {
      setError(body.error ?? "No se pudo aprobar la compra.");
      return;
    }
    setAviso(body.aviso_drive ?? null);
    setAbierto(null);
    router.refresh();
  }

  function Pedido({ r, mio }: { r: RequerimientoConRelaciones; mio: boolean }) {
    const suyas = cotizaciones[r.id] ?? [];
    const totales = suyas.map((c) => c.precio_total).filter((t): t is number => t !== null);
    const minimo = totales.length > 0 ? Math.min(...totales) : null;
    const dias = diasRestantes(r.fecha_necesidad);
    const vencido = dias !== null && dias < 0;

    return (
      <article className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-start justify-between gap-2 px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/compras/requerimientos/${r.id}`}
                className="font-mono text-xs font-semibold text-[var(--primary)] hover:underline"
              >
                RI {r.nro_ri}
              </Link>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${etiquetaPrioridad(r.prioridad).color}`}>
                {etiquetaPrioridad(r.prioridad).label}
              </span>
            </div>
            <p className="mt-1 text-sm font-semibold text-slate-900">{r.descripcion}</p>
            <p className="text-xs text-slate-500">
              {r.compras_areas?.nombre ?? "Sin área"} · Pedido el {fecha(r.fecha)}
              {r.fecha_necesidad && (
                <span className={vencido ? " font-semibold text-red-600" : ""}>
                  {vencido ? ` · vencido hace ${Math.abs(dias!)} d` : ` · se necesita el ${fecha(r.fecha_necesidad)}`}
                </span>
              )}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {suyas.length === 0
                ? "Sin presupuestos cargados"
                : `${suyas.length} presupuesto(s) · el más barato ${moneda(minimo)}`}
            </p>
          </div>

          {mio && (
            <button
              onClick={() => setAbierto(abierto === r.id ? null : r.id)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {abierto === r.id ? "Cerrar" : "Ver y decidir"}
            </button>
          )}
        </div>

        {mio && abierto === r.id && (
          <div className="border-t border-slate-100 px-5 py-4">
            {suyas.length > 0 ? (
              <ComparativaDecision
                cotizaciones={suyas}
                minimo={minimo}
                onElegir={elegir}
                eligiendo={eligiendo}
              />
            ) : (
              <p className="text-sm text-slate-500">
                No hay presupuestos cargados en el sistema.{" "}
                {r.comparativa_url && (
                  <a href={r.comparativa_url} target="_blank" rel="noreferrer" className="underline">
                    Ver la comparativa en la planilla
                  </a>
                )}
              </p>
            )}
          </div>
        )}
      </article>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Para aprobar</h1>
        <p className="text-sm text-slate-500">
          Compras esperando el visto bueno. Elegir un presupuesto aprueba la compra.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {aviso && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{aviso}</div>
      )}

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Te toca a vos ({mios.length})
        </h2>
        {mios.length === 0 ? (
          <p className="text-sm text-slate-400">No tenés compras esperando tu decisión.</p>
        ) : (
          mios.map((r) => <Pedido key={r.id} r={r} mio />)
        )}
      </section>

      {deOtros.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Esperando a otros ({deOtros.length})
          </h2>
          {deOtros.map((r) => <Pedido key={r.id} r={r} mio={false} />)}
        </section>
      )}
    </div>
  );
}
```

El `as unknown as Cotizacion[]` no es pereza: cuando el `select` lleva un
recurso embebido, Supabase infiere `proveedores` como arreglo y choca con el
tipo `Cotizacion`, que lo declara como objeto. Es el mismo error que apareció al
armar el resumen del tablero. Con el genérico de `traerTodo` no hay forma de
conciliarlos, y la forma real de la respuesta sí corresponde a `Cotizacion`.

- [ ] **Step 3: Verificar tipos y build**

Run: `npx tsc --noEmit && npm run build`
Expected: sin errores; la ruta `/compras/para-aprobar` aparece en el listado del build.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/compras/para-aprobar"
git commit -m "feat(compras): bandeja Para aprobar, con la comparativa desplegable"
```

---

## Tarea 10: Verificar en el navegador

- [ ] **Step 1: Levantar la app**

Usar la herramienta de preview con la configuración `sdg-dev` de `.claude/launch.json`.

- [ ] **Step 2: Recorrer**

1. Con un usuario que esté en la lista: aparecen "Aprobaciones" y "Para aprobar" en el menú.
2. Con un usuario admin del módulo que NO esté en la lista: no aparecen, y entrar a `/compras/para-aprobar` a mano redirige a `/compras`.
3. En la bandeja, un pedido asignado al usuario se despliega y muestra la comparativa.
4. Elegir un presupuesto aprueba la compra y el pedido desaparece de la bandeja.
5. En `/compras/configuracion`, quitar al último de la lista muestra el mensaje y no lo saca.

- [ ] **Step 3: Revisar consola y red**

Sin errores de consola. Las llamadas responden 200/201.

---

## Tarea 11: Documentación

**Files:**
- Modify: `docs/COMPRAS.md`

- [ ] **Step 1: Actualizar la tabla de permisos**

Reemplazar la tabla de niveles por:

```markdown
| Nivel | Qué puede |
|---|---|
| `lectura` | consultar |
| `edicion` | cargar comparativas y presupuestos, gestionar proveedor, costos y OC, asignar a quién le toca aprobar, y avanzar los estados del circuito |
| `admin` | lo mismo, y además administrar el módulo: quiénes están en la lista de aprobadores |

**Aprobar no es un nivel: es estar en la lista** de `/compras/configuracion`.
Vale para las dos aprobaciones —la del requerimiento y la de la compra— y no
alcanza con ser administrador del módulo ni del sistema. Administrar es
configurar; aprobar es autorizar plata, y las hacen personas distintas.

Aprobar una compra pide las dos cosas: estar en la lista y ser la persona a la
que se le asignó.
```

- [ ] **Step 2: Sumar la pantalla a la tabla de rutas**

```markdown
| `/compras/para-aprobar` | Bandeja de quien aprueba: lo suyo arriba, lo de otros abajo |
```

- [ ] **Step 3: Commit**

```bash
git add docs/COMPRAS.md
git commit -m "docs(compras): aprobar es la lista, y la bandeja Para aprobar"
```

---

## Después de este plan

- **Restaurar los 15 RI** que la sincronización mandó de `PEDIDO` a `SIN_INICIAR`: el historial guarda el valor anterior de cada uno. Quedó pendiente de decisión del usuario.
- **El histórico de precios por artículo**: las cotizaciones de otros RI sobre el mismo artículo, al lado de la comparativa. Salió al resolver lo de CORREAS.
- **El seguimiento de recepción** (`RECIBIDO`), que además destraba la columna Pedido del tablero.
