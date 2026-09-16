# Asistente — plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans` para ejecutar tarea por tarea.
> Los pasos usan checkbox (`- [ ]`) para seguimiento.

**Objetivo:** Un asistente de IA transversal al SdG que contesta preguntas sobre
los datos del sistema respetando los permisos de cada usuario, explica cómo se
usa el sistema, y puede dejar armada un alta para que una persona la confirme.

**Arquitectura:** La IA genera SQL y lo ejecuta **con la sesión del usuario**,
por GET, así que RLS decide qué se ve y Postgres rechaza cualquier escritura. El
catálogo de esquema que ve el modelo se genera de `information_schema` y se
filtra por los módulos del usuario. Las altas no las escribe la IA: devuelve una
URL a la pantalla de siempre, prellenada.

**Stack:** Next.js 16 App Router, Supabase (PostgREST + RLS), Vercel AI Gateway
con AI SDK v6, vitest.

**Spec:** [`docs/superpowers/specs/2026-09-16-asistente-design.md`](../specs/2026-09-16-asistente-design.md)

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/<marca>_asistente_el_permiso.sql` | La columna `puede_usar_asistente` |
| `supabase/migrations/<marca>_asistente_la_consulta_y_la_bitacora.sql` | `asistente_consulta()` + tabla `asistente_consultas` |
| `lib/core/access.ts` (modificar) | `puedeUsarAsistente()`, al lado de `esAdminDelNucleo` |
| `lib/asistente/validarConsulta.ts` | Espejo en TS del guard de la función. Puro |
| `lib/asistente/urlDeCarga.ts` | Arma la URL del formulario prellenado. Puro |
| `lib/asistente/modulos.ts` | Mapa tabla → módulo. Cierra por defecto |
| `lib/asistente/notas.ts` | Qué significa cada tabla y sus trampas, a mano |
| `lib/asistente/catalogo.generado.json` | Esquema real, generado |
| `lib/asistente/catalogo.ts` | `armarCatalogo()` puro + `catalogoPara()` |
| `lib/asistente/documentos.ts` | Qué doc de `docs/` puede leer cada módulo |
| `lib/asistente/consulta.ts` | Llama a la RPC con el cliente del usuario |
| `lib/asistente/prompt.ts` | El system prompt. Puro |
| `lib/asistente/herramientas.ts` | Las tres tools del AI SDK |
| `app/api/asistente/route.ts` | La ruta: permiso, tope diario, streaming, bitácora |
| `components/Asistente.tsx` | El panel lateral + atajo |
| `components/Header.tsx` (modificar) | Monta el panel |
| `docs/ASISTENTE.md` | El documento del módulo |

**Orden:** las dos migraciones bloquean todo lo demás — **correlas primero**.
Después el núcleo puro (tareas 3-8), que se testea sin base ni red; después el
backend; después la pantalla; y las cargas al final, porque son independientes y
el asistente sirve sin ellas.

---

## Fase 0 — Las migraciones (las corre una persona)

> El agente **no puede correr DDL**. Escribe los dos archivos y **queda a la
> espera** de que el usuario los aplique en el editor SQL de Supabase.

### Tarea 1: Migración del permiso

**Archivos:**
- Crear: `supabase/migrations/<marca>_asistente_el_permiso.sql`

- [ ] **Paso 1: Crear el archivo con marca de tiempo**

```bash
npm run migracion "asistente el permiso"
```

Imprime la ruta creada. Usala en el paso siguiente.

- [ ] **Paso 2: Escribir la migración**

Reemplazá el contenido del archivo por esto (dejando el encabezado que el script
ya puso, con este texto):

```sql
-- ============================================================
-- SdG — Asistente: el permiso
--
-- Quién puede usar el asistente de IA. Es una columna y no un valor más del
-- enum `app_module` por dos razones.
--
-- La conocida: un valor de enum nuevo tiene que viajar solo en su propia
-- migración (55P04), y ya costó dos veces. Pero además arrastraría al
-- asistente a `MODULOS_ORDEN` y al sidebar, donde no va: no es una sección.
--
-- La conceptual: los módulos responden *qué parte del sistema ves*; esto
-- responde *con qué herramienta la mirás*. Son ejes distintos, y mezclarlos
-- ensucia `modulosVisibles`, que hoy se entiende entera de una lectura.
--
-- Arranca en false para todos, a propósito: la barrera no es de seguridad
-- —de eso se ocupa RLS, que es quien ejecuta la consulta— sino de costo. Se
-- abre de a poco y se mide con `asistente_consultas`.
-- ============================================================

alter table usuarios
  add column if not exists puede_usar_asistente boolean not null default false;

comment on column usuarios.puede_usar_asistente is
  'Si puede usar el asistente de IA. No es un permiso de datos: lo que ve al '
  'preguntar sale de RLS igual que en las pantallas. Es un permiso de gasto.';
```

- [ ] **Paso 3: Pedirle al usuario que la corra**

Decile: *"Está lista `<ruta>`. Corrémela en el editor SQL de Supabase y avisame."*
**No sigas hasta que confirme.**

- [ ] **Paso 4: Verificar que corrió**

```bash
node -e "const{createClient}=require('@supabase/supabase-js');const fs=require('fs');for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY).from('usuarios').select('id,puede_usar_asistente').limit(1).then(r=>console.log(r.error?'FALTA: '+r.error.message:'OK '+JSON.stringify(r.data)))"
```

Esperado: `OK [{"id":"…","puede_usar_asistente":false}]`
Si dice `FALTA: column usuarios.puede_usar_asistente does not exist`, la
migración no corrió.

- [ ] **Paso 5: Commit**

```bash
git add supabase/migrations/<marca>_asistente_el_permiso.sql
git commit -m "feat(asistente): el permiso para usar el asistente, como columna y no como modulo"
```

---

### Tarea 2: Migración de la consulta y la bitácora

**Archivos:**
- Crear: `supabase/migrations/<marca>_asistente_la_consulta_y_la_bitacora.sql`

- [ ] **Paso 1: Crear el archivo**

```bash
npm run migracion "asistente la consulta y la bitacora"
```

- [ ] **Paso 2: Escribir la migración**

```sql
-- ============================================================
-- SdG — Asistente: la consulta y la bitácora
--
-- `asistente_consulta()` es por dónde el asistente lee la base. Tres cosas la
-- hacen segura, y sólo la primera es de la base misma:
--
-- 1. Es **security invoker** (el default). Corre como el usuario que llama,
--    con su `auth.uid()`, así que RLS decide qué filas ve. No hay que
--    reimplementar permisos: ocho de los nueve módulos ya tienen la lectura
--    gateada (`tiene_acceso_rrhh()`, `mant_puede_ver()`, …). Compras es la
--    excepción y es deliberada desde la 018.
--
-- 2. Es **stable**, para que PostgREST la acepte por GET — y PostgREST corre
--    los GET en una transacción de sólo lectura. Ahí está la barrera de
--    verdad: si el modelo escribe un UPDATE, lo rechaza Postgres.
--
-- 3. El chequeo de texto de abajo es la **tercera** capa, y está para dar un
--    mensaje claro, no para defender. Un guard por expresión regular sobre
--    SQL siempre se puede esquivar; una transacción de sólo lectura no.
--
-- Sobre el timeout: NO se pone acá. `statement_timeout` no se puede cambiar
-- para la sentencia que ya está corriendo, así que un `set` dentro de la
-- función no haría nada — sería una falsa tranquilidad. El que aplica es el
-- del rol `authenticated`, que Supabase ya trae configurado. Se verifica
-- corriendo `select current_setting('statement_timeout')` por esta misma
-- función.
--
-- El tope de filas sí va acá, explícito, porque el que no se ve es el que
-- muerde: PostgREST corta en 1000 y no avisa. Devolver un jsonb esquiva ese
-- corte (es un valor, no mil filas), así que el límite tiene que ser propio.
-- ============================================================

create or replace function public.asistente_consulta(
  consulta text,
  tope integer default 200
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  limpio text := btrim(consulta);
  resultado jsonb;
begin
  if limpio !~* '^(select|with)\s' then
    raise exception 'El asistente sólo puede leer: la consulta tiene que empezar con SELECT o WITH.';
  end if;

  -- Un punto y coma final es normal; uno en el medio son dos sentencias.
  if position(';' in rtrim(limpio, ' ;')) > 0 then
    raise exception 'Una consulta por vez: sacá el punto y coma del medio.';
  end if;

  if tope < 1 or tope > 1000 then
    raise exception 'El tope de filas va entre 1 y 1000.';
  end if;

  execute format(
    'select coalesce(jsonb_agg(f), ''[]''::jsonb) from (select * from (%s) sub limit %s) f',
    limpio, tope
  ) into resultado;

  return resultado;
end $$;

comment on function public.asistente_consulta(text, integer) is
  'Lectura del asistente de IA. security invoker + stable: corre como el '
  'usuario con RLS, y por GET queda en transacción de sólo lectura.';

revoke all on function public.asistente_consulta(text, integer) from public;
grant execute on function public.asistente_consulta(text, integer) to authenticated;

-- ── La bitácora ──────────────────────────────────────────────
-- Sirve para dos cosas a la vez, y por eso vale la tabla: corta el gasto
-- (el tope diario se cuenta acá) y dice qué se pregunta de verdad, que es lo
-- que después decide si valen la pena las vistas de consulta que el spec
-- dejó explícitamente para después.

create table if not exists asistente_consultas (
  id              uuid primary key default gen_random_uuid(),
  usuario_id      uuid not null references usuarios(id) on delete cascade,
  pregunta        text not null,
  sql_corrido     text,
  filas           integer,
  tokens_entrada  integer,
  tokens_salida   integer,
  error           text,
  creado_en       timestamptz not null default now()
);

create index if not exists asistente_consultas_usuario_idx
  on asistente_consultas (usuario_id, creado_en desc);

alter table asistente_consultas enable row level security;

drop policy if exists asistente_consultas_select on asistente_consultas;
create policy asistente_consultas_select on asistente_consultas
  for select to authenticated
  using (usuario_id = auth.uid() or es_admin_sistema());

drop policy if exists asistente_consultas_insert on asistente_consultas;
create policy asistente_consultas_insert on asistente_consultas
  for insert to authenticated
  with check (usuario_id = auth.uid());

notify pgrst, 'reload schema';
```

- [ ] **Paso 3: Pedirle al usuario que la corra**

Decile: *"Está lista `<ruta>`. Corrémela y avisame."* **No sigas hasta que confirme.**

- [ ] **Paso 4: Verificar las tres cosas que importan, contra la base real**

Este script comprueba lo que no se puede deducir leyendo documentación: que un
SELECT anda, que un UPDATE lo rechaza Postgres, y cuánto es el timeout real.

Creá `scripts/tmp-probar-asistente-consulta.mts`:

```ts
// Prueba `asistente_consulta` contra la base real, con una sesión de usuario
// (no con la service role: el punto es justamente que RLS aplique).
//
// Temporal: se borra cuando la tarea 8 deja el test permanente.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const email = process.argv[2];
const password = process.argv[3];
if (!email || !password) {
  console.error("Uso: npx tsx scripts/tmp-probar-asistente-consulta.mts <email> <password>");
  process.exit(1);
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
const { error: errorLogin } = await db.auth.signInWithPassword({ email, password });
if (errorLogin) { console.error("No entró:", errorLogin.message); process.exit(1); }

async function probar(titulo: string, consulta: string) {
  const { data, error } = await db.rpc("asistente_consulta", { consulta }, { get: true });
  console.log(`\n── ${titulo}`);
  console.log(error ? `   ERROR: ${error.message}` : `   OK: ${JSON.stringify(data).slice(0, 200)}`);
}

await probar("un select simple", "select count(*) as n from empresas");
await probar("el timeout real del rol", "select current_setting('statement_timeout') as t");
await probar("un update (tiene que fallar)", "update empresas set nombre = nombre");
await probar("un update disfrazado de select", "select 1; update empresas set nombre = nombre");
await probar("una tabla de otro módulo", "select count(*) as n from liquidaciones");
```

Correlo con un usuario de prueba que **no** tenga RRHH:

```bash
npx tsx scripts/tmp-probar-asistente-consulta.mts <email> <password>
```

Esperado:
- `un select simple` → `OK: [{"n":2}]`
- `el timeout real del rol` → `OK: [{"t":"8s"}]` (o el valor que tenga; **anotalo**)
- `un update (tiene que fallar)` → `ERROR: …sólo puede leer…`
- `un update disfrazado de select` → `ERROR: …punto y coma…`
- `una tabla de otro módulo` → `OK: [{"n":0}]` — **cero filas, no un error**. Así
  se ve RLS trabajando.

> Si `el timeout real del rol` devuelve `0` (sin límite), avisale al usuario:
> hay que ponerle un `statement_timeout` al rol `authenticated` desde el panel
> de Supabase. No sigas sin resolverlo: una consulta pesada sin techo es la
> forma más fácil de que el asistente tire la base.

- [ ] **Paso 5: Commit**

```bash
git add supabase/migrations/<marca>_asistente_la_consulta_y_la_bitacora.sql
git commit -m "feat(asistente): la funcion de lectura y la bitacora de consultas"
```

---

## Fase 1 — El núcleo puro

### Tarea 3: `puedeUsarAsistente`

**Archivos:**
- Modificar: `lib/core/access.ts`
- Modificar: `lib/core/types.ts`
- Test: `lib/core/access.test.ts`

- [ ] **Paso 1: Escribir el test que falla**

Agregá al final de `lib/core/access.test.ts`:

```ts
describe("quién puede usar el asistente", () => {
  it("lo deja pasar si lo tiene concedido", () => {
    expect(puedeUsarAsistente({ rol: "operario", puede_usar_asistente: true })).toBe(true);
  });

  it("no lo deja pasar si no lo tiene, aunque sea encargado", () => {
    expect(puedeUsarAsistente({ rol: "encargado", puede_usar_asistente: false })).toBe(false);
  });

  // admin_sistema pasa siempre por la misma razón que en el resto del núcleo:
  // es quien concede el permiso, y no poder probarlo sin concedérselo a sí
  // mismo es un lazo bobo.
  it("admin_sistema pasa aunque la columna diga que no", () => {
    expect(puedeUsarAsistente({ rol: "admin_sistema", puede_usar_asistente: false })).toBe(true);
  });

  it("sin usuario, no", () => {
    expect(puedeUsarAsistente(null)).toBe(false);
    expect(puedeUsarAsistente(undefined)).toBe(false);
  });
});
```

Y agregá `puedeUsarAsistente` al import que ya está arriba del archivo.

- [ ] **Paso 2: Correr el test para verificar que falla**

```bash
npx vitest run lib/core/access.test.ts
```

Esperado: FAIL — `puedeUsarAsistente is not a function` / error de TypeScript al importar.

- [ ] **Paso 3: Implementar**

En `lib/core/types.ts`, agregá el campo a `Usuario`:

```ts
export interface Usuario {
  id: string;
  email: string;
  nombre: string;
  apellido: string;
  rol: Rol;
  activo: boolean;
  /** Si puede usar el asistente de IA. Es un permiso de gasto, no de datos. */
  puede_usar_asistente: boolean;
}
```

En `lib/core/access.ts`, al final:

```ts
/**
 * Quién puede usar el asistente de IA.
 *
 * **No es un permiso de datos.** Lo que el asistente le muestra a cada uno sale
 * de RLS, igual que en las pantallas: la consulta la ejecuta la sesión del
 * usuario. Esto es un permiso de **gasto** — cada pregunta son dos o tres
 * llamadas a un modelo — y por eso arranca cerrado y se abre de a poco.
 *
 * `admin_sistema` pasa siempre, como en el resto del núcleo: es quien concede
 * el permiso, y obligarlo a concedérselo a sí mismo para poder probar no
 * protege de nada.
 *
 * Vive acá y no en la ruta por la misma razón que `esAdminDelNucleo`: cuatro
 * copias de una regla de permisos son tres de más.
 */
export function puedeUsarAsistente(
  usuario: { rol: Rol; puede_usar_asistente?: boolean | null } | null | undefined
): boolean {
  if (!usuario) return false;
  if (usuario.rol === "admin_sistema") return true;
  return usuario.puede_usar_asistente === true;
}
```

- [ ] **Paso 4: Correr el test**

```bash
npx vitest run lib/core/access.test.ts
```

Esperado: PASS, todos.

- [ ] **Paso 5: Verificar que el campo nuevo no rompió tipos**

```bash
npx tsc --noEmit
```

Esperado: sin errores. Si alguno aparece por `Usuario` sin `puede_usar_asistente`,
**mirá `git status` antes de tocarlo**: puede ser de otra sesión.

- [ ] **Paso 6: Commit**

```bash
git add lib/core/access.ts lib/core/access.test.ts lib/core/types.ts
git commit -m "feat(asistente): quien puede usarlo, al lado del resto de los permisos del nucleo"
```

---

### Tarea 4: `validarConsulta`

Espejo en TS del guard de la función. No es la defensa —esa es la transacción de
sólo lectura— pero evita un viaje de red y da un mensaje que el modelo entiende
y puede corregir.

**Archivos:**
- Crear: `lib/asistente/validarConsulta.ts`
- Test: `lib/asistente/validarConsulta.test.ts`

- [ ] **Paso 1: Escribir el test que falla**

```ts
import { describe, it, expect } from "vitest";
import { validarConsulta } from "./validarConsulta";

describe("lo que el asistente puede consultar", () => {
  it("deja pasar un select", () => {
    expect(validarConsulta("select count(*) from empresas")).toEqual({ ok: true });
  });

  it("deja pasar un with", () => {
    expect(validarConsulta("with x as (select 1 as n) select * from x")).toEqual({ ok: true });
  });

  it("deja pasar un punto y coma final, que es lo normal al copiar", () => {
    expect(validarConsulta("select 1;")).toEqual({ ok: true });
    expect(validarConsulta("select 1;  ")).toEqual({ ok: true });
  });

  it("rechaza una escritura", () => {
    const r = validarConsulta("update empresas set nombre = 'x'");
    expect(r.ok).toBe(false);
  });

  it("rechaza dos sentencias", () => {
    const r = validarConsulta("select 1; drop table empresas");
    expect(r.ok).toBe(false);
  });

  // El caso que un prefijo ingenuo deja pasar: el select está adentro de un
  // comentario y la sentencia real es otra.
  it("rechaza una escritura escondida detrás de un comentario", () => {
    expect(validarConsulta("/* select */ delete from empresas").ok).toBe(false);
    expect(validarConsulta("-- select\ndelete from empresas").ok).toBe(false);
  });

  it("acepta un comentario delante de un select de verdad", () => {
    expect(validarConsulta("-- cuántas empresas hay\nselect count(*) from empresas")).toEqual({ ok: true });
  });

  it("rechaza el vacío", () => {
    expect(validarConsulta("   ").ok).toBe(false);
  });
});
```

- [ ] **Paso 2: Correr para verificar que falla**

```bash
npx vitest run lib/asistente/validarConsulta.test.ts
```

Esperado: FAIL — no existe el módulo.

- [ ] **Paso 3: Implementar**

```ts
/**
 * Si una consulta del asistente tiene forma de lectura.
 *
 * **Esto no es la defensa.** La defensa es que la consulta se manda por GET y
 * PostgREST corre los GET en una transacción de sólo lectura: un UPDATE lo
 * rechaza Postgres, no esto. Un guard por expresión regular sobre SQL siempre
 * se puede esquivar, y creer lo contrario es peor que no tenerlo.
 *
 * Está por dos razones prácticas: evita un viaje de red cuando el modelo se
 * equivoca feo, y le devuelve un motivo en castellano que puede usar para
 * corregir en el intento siguiente.
 *
 * Es espejo del chequeo de `asistente_consulta()` en la base. Si cambia uno,
 * cambia el otro.
 */
export type Veredicto = { ok: true } | { ok: false; motivo: string };

/** Saca comentarios de línea y de bloque, para mirar la sentencia de verdad. */
function sinComentarios(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .trim();
}

export function validarConsulta(sql: string): Veredicto {
  const desnudo = sinComentarios(sql);

  if (!desnudo) {
    return { ok: false, motivo: "La consulta está vacía." };
  }

  if (!/^(select|with)\s/i.test(desnudo)) {
    return {
      ok: false,
      motivo: "El asistente sólo puede leer: la consulta tiene que empezar con SELECT o WITH.",
    };
  }

  // Un punto y coma al final es normal; uno en el medio son dos sentencias.
  if (desnudo.replace(/[\s;]+$/, "").includes(";")) {
    return { ok: false, motivo: "Una consulta por vez: sacá el punto y coma del medio." };
  }

  return { ok: true };
}
```

- [ ] **Paso 4: Correr el test**

```bash
npx vitest run lib/asistente/validarConsulta.test.ts
```

Esperado: PASS, 8 tests.

- [ ] **Paso 5: Commit**

```bash
git add lib/asistente/validarConsulta.ts lib/asistente/validarConsulta.test.ts
git commit -m "feat(asistente): el guard de texto de la consulta, que no es la defensa y lo dice"
```

---

### Tarea 5: `urlDeCarga`

**Archivos:**
- Crear: `lib/asistente/urlDeCarga.ts`
- Test: `lib/asistente/urlDeCarga.test.ts`

- [ ] **Paso 1: Escribir el test que falla**

```ts
import { describe, it, expect } from "vitest";
import { urlDeCarga } from "./urlDeCarga";

describe("la URL del formulario prellenado", () => {
  it("arma el alta de un requerimiento", () => {
    const r = urlDeCarga("requerimiento", { descripcion: "Filtro de aceite", cantidad: "4" });
    expect(r).toEqual({
      ok: true,
      url: "/compras/requerimientos?nuevo=1&descripcion=Filtro+de+aceite&cantidad=4",
    });
  });

  /**
   * El comentario de `ValoresIniciales` en NuevoRequerimientoModal dice que el
   * área y quién paga no se precargan a propósito: son decisiones de quien
   * pide, y elegirlas por él es cómo un pedido de Mantenimiento entra como si
   * fuera de Producción. Acá se rechaza explícito, no por omisión.
   */
  it("rechaza el área del requerimiento, que es decisión de quien pide", () => {
    const r = urlDeCarga("requerimiento", { descripcion: "x", area: "MANTENIMIENTO" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain("área");
  });

  it("rechaza quién paga por el mismo motivo", () => {
    expect(urlDeCarga("requerimiento", { descripcion: "x", paga: "POLCECAL" }).ok).toBe(false);
  });

  it("arma el movimiento de inventario", () => {
    expect(urlDeCarga("movimiento", { articulo: "abc-123", cantidad: "2" })).toEqual({
      ok: true,
      url: "/inventario/movimientos/nuevo?articulo=abc-123&cantidad=2",
    });
  });

  it("arma el aviso de mantenimiento", () => {
    expect(urlDeCarga("aviso", { equipo: "eq-7", descripcion: "Pierde aceite" })).toEqual({
      ok: true,
      url: "/mantenimiento/avisos?nuevo=1&equipo=eq-7&descripcion=Pierde+aceite",
    });
  });

  it("arma el parte de producción, que son dos segmentos y no query", () => {
    expect(urlDeCarga("parte", { fecha: "2026-09-16", turno: "4_12" })).toEqual({
      ok: true,
      url: "/produccion/parte/2026-09-16/4_12",
    });
  });

  it("rechaza un turno que no existe", () => {
    expect(urlDeCarga("parte", { fecha: "2026-09-16", turno: "noche" }).ok).toBe(false);
  });

  it("rechaza una fecha que no es una fecha", () => {
    expect(urlDeCarga("parte", { fecha: "16/09/2026", turno: "4_12" }).ok).toBe(false);
  });

  it("rechaza un tipo que no existe", () => {
    // @ts-expect-error — el modelo puede mandar cualquier cosa; la función no confía en el tipo
    expect(urlDeCarga("factura", { total: "100" }).ok).toBe(false);
  });

  it("rechaza un campo que el formulario no tiene", () => {
    expect(urlDeCarga("aviso", { color: "rojo" }).ok).toBe(false);
  });

  it("ignora los campos vacíos en vez de mandarlos en blanco", () => {
    expect(urlDeCarga("requerimiento", { descripcion: "x", cantidad: "" })).toEqual({
      ok: true,
      url: "/compras/requerimientos?nuevo=1&descripcion=x",
    });
  });

  // Mismo criterio que `volverAlListado` en lib/compras/filtrosUrl.ts: lo que
  // entra a una URL se escapa, siempre.
  it("escapa lo que podría salirse de la query", () => {
    const r = urlDeCarga("aviso", { descripcion: "a&b=c #1" });
    expect(r).toEqual({
      ok: true,
      url: "/mantenimiento/avisos?nuevo=1&descripcion=a%26b%3Dc+%231",
    });
  });
});
```

- [ ] **Paso 2: Correr para verificar que falla**

```bash
npx vitest run lib/asistente/urlDeCarga.test.ts
```

Esperado: FAIL — no existe el módulo.

- [ ] **Paso 3: Implementar**

```ts
/**
 * La URL que abre un formulario del sistema con los campos ya puestos.
 *
 * **Es la única forma en que el asistente participa de una carga.** No escribe
 * en la base: arma la intención, y la pantalla de siempre hace lo de siempre —
 * con su validación, su exportación a planilla y su manejo de
 * `sheets_pendiente`. Un segundo camino de escritura es un camino que se puede
 * olvidar de exportar, y eso es una divergencia que no avisa.
 *
 * Todos los tipos son **altas en estado pendiente**. Ninguno cambia el estado
 * de algo que ya existe: un estado dispara la planilla y, en Facturación, un
 * asiento en Odoo que no se deshace.
 *
 * Se apoya en una convención que el repo ya tiene —la URL es el estado de la
 * pantalla, `lib/core/usarLaUrl.ts`— y en que tres de los cuatro formularios ya
 * saben abrirse con datos puestos.
 */

export type TipoDeCarga = "requerimiento" | "movimiento" | "aviso" | "parte";

export type Armada =
  | { ok: true; url: string }
  | { ok: false; motivo: string };

/**
 * Qué campos acepta cada alta.
 *
 * La lista es cerrada de los dos lados: un campo que no está se rechaza, y no
 * se ignora en silencio. Si el modelo cree que mandó el área y la función la
 * descartó sin decir nada, va a contestar que el RI queda armado con el área
 * puesta, y no.
 */
const CAMPOS: Record<TipoDeCarga, readonly string[]> = {
  requerimiento: ["descripcion", "codigo", "cantidad", "detalle"],
  movimiento: ["articulo", "cantidad"],
  aviso: ["equipo", "descripcion", "urgencia"],
  parte: ["fecha", "turno"],
};

/**
 * Campos que existen en el formulario y que el asistente **no** puede tocar,
 * con el motivo. Se distinguen de los desconocidos porque el mensaje tiene que
 * ser distinto: uno es un error del modelo, el otro es una regla del sistema.
 */
const PROHIBIDOS: Partial<Record<TipoDeCarga, Record<string, string>>> = {
  requerimiento: {
    area:
      "El área del requerimiento la elige quien pide: precargarla es cómo un pedido " +
      "de Mantenimiento entra como si fuera de Producción.",
    paga: "Quién paga lo decide quien pide, igual que el área.",
  },
};

const TURNOS = ["4_12", "12_20"] as const;

export function urlDeCarga(tipo: TipoDeCarga, campos: Record<string, string>): Armada {
  const permitidos = CAMPOS[tipo];
  if (!permitidos) {
    return { ok: false, motivo: `No sé armar una carga de tipo "${tipo}".` };
  }

  const prohibidos = PROHIBIDOS[tipo] ?? {};
  for (const clave of Object.keys(campos)) {
    if (prohibidos[clave]) return { ok: false, motivo: prohibidos[clave] };
    if (!permitidos.includes(clave)) {
      return {
        ok: false,
        motivo: `El formulario de ${tipo} no tiene un campo "${clave}". Los que tiene: ${permitidos.join(", ")}.`,
      };
    }
  }

  if (tipo === "parte") {
    const { fecha, turno } = campos;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha ?? "")) {
      return { ok: false, motivo: "La fecha del parte va en AAAA-MM-DD." };
    }
    if (!TURNOS.includes(turno as (typeof TURNOS)[number])) {
      return { ok: false, motivo: `El turno es ${TURNOS.join(" o ")}.` };
    }
    return { ok: true, url: `/produccion/parte/${fecha}/${turno}` };
  }

  const query = new URLSearchParams();
  if (tipo === "requerimiento" || tipo === "aviso") query.set("nuevo", "1");
  // El orden de `permitidos` y no el de `campos`: así la URL es estable y los
  // tests no dependen de en qué orden el modelo armó el objeto.
  for (const clave of permitidos) {
    const valor = campos[clave];
    if (valor !== undefined && valor !== "") query.set(clave, valor);
  }

  const base =
    tipo === "requerimiento"
      ? "/compras/requerimientos"
      : tipo === "aviso"
      ? "/mantenimiento/avisos"
      : "/inventario/movimientos/nuevo";

  return { ok: true, url: `${base}?${query.toString()}` };
}
```

- [ ] **Paso 4: Correr el test**

```bash
npx vitest run lib/asistente/urlDeCarga.test.ts
```

Esperado: PASS, 12 tests.

- [ ] **Paso 5: Commit**

```bash
git add lib/asistente/urlDeCarga.ts lib/asistente/urlDeCarga.test.ts
git commit -m "feat(asistente): la URL del formulario prellenado, con el area del RI rechazada a proposito"
```

---

### Tarea 6: El mapa de tablas a módulos

**Archivos:**
- Crear: `lib/asistente/modulos.ts`
- Test: `lib/asistente/modulos.test.ts`

- [ ] **Paso 1: Escribir el test que falla**

```ts
import { describe, it, expect } from "vitest";
import { MODULO_DE_TABLA, moduloDe, tablasVisibles } from "./modulos";

describe("de qué módulo es cada tabla", () => {
  it("ubica una tabla de un módulo", () => {
    expect(moduloDe("liquidaciones")).toBe("rrhh");
    expect(moduloDe("compras_requerimientos")).toBe("compras");
  });

  it("marca como del núcleo lo que comparten todos", () => {
    expect(moduloDe("empleados")).toBe("nucleo");
    expect(moduloDe("productos")).toBe("nucleo");
  });

  /**
   * Cierra por defecto. Es la diferencia entre que una tabla nueva quede
   * invisible y que quede expuesta, y una de las dos se arregla sola cuando
   * alguien la reporta.
   */
  it("una tabla que nadie mapeó no es de nadie", () => {
    expect(moduloDe("tabla_que_no_existe_todavia")).toBeNull();
  });
});

describe("qué tablas ve cada usuario", () => {
  it("le da las suyas más las del núcleo", () => {
    const visibles = tablasVisibles(["rrhh"]);
    expect(visibles).toContain("liquidaciones");
    expect(visibles).toContain("empleados");
    expect(visibles).not.toContain("despacho_ordenes_carga");
  });

  it("sin ningún módulo, igual ve el núcleo", () => {
    const visibles = tablasVisibles([]);
    expect(visibles).toContain("empleados");
    expect(visibles).not.toContain("liquidaciones");
  });

  it("no incluye nunca una tabla sin mapear", () => {
    const visibles = tablasVisibles(["rrhh", "compras", "mantenimiento"]);
    for (const t of visibles) expect(MODULO_DE_TABLA[t]).toBeDefined();
  });
});
```

- [ ] **Paso 2: Correr para verificar que falla**

```bash
npx vitest run lib/asistente/modulos.test.ts
```

Esperado: FAIL — no existe el módulo.

- [ ] **Paso 3: Implementar**

```ts
import type { Modulo } from "@/lib/core/types";

/**
 * De qué módulo es cada tabla, para decidir qué le mostramos a quién.
 *
 * **Esto no es la barrera de permisos.** La barrera es que la consulta la
 * ejecuta la sesión del usuario con RLS: si el modelo pregunta por una tabla
 * que no le corresponde, la base devuelve cero filas. Este mapa hace que el
 * asistente sea *útil* —el prompt es chico y no le cuenta a un operario de
 * Remises que existe `liquidaciones`— no que sea *seguro*. Un bug acá no es
 * una filtración: es una pregunta sin respuesta.
 *
 * **Cierra por defecto.** Una tabla que no está acá no se le muestra a nadie, y
 * `scripts/generar-catalogo-asistente.mjs` la reporta al final de la corrida.
 * Es la diferencia entre que una tabla nueva quede invisible —molesto, y
 * alguien avisa— y que quede expuesta —silencioso, y nadie avisa.
 *
 * `nucleo` son los catálogos compartidos: se leen desde los nueve módulos y sus
 * policies son abiertas para cualquier autenticado.
 */
export type Ambito = Modulo | "nucleo";

export const MODULO_DE_TABLA: Record<string, Ambito> = {
  // ── Núcleo: lectura abierta para cualquier autenticado ──
  empresas: "nucleo",
  sectores: "nucleo",
  empleados: "nucleo",
  proveedores: "nucleo",
  proveedores_odoo: "nucleo",
  productos: "nucleo",
  usuarios: "nucleo",
  usuario_modulos: "nucleo",
  cotizaciones_dolar: "nucleo",
  sincronizaciones: "nucleo",
  empresa_status_log: "nucleo",
  sectores_status_log: "nucleo",

  // ── RRHH ──
  rrhh_empleados_datos: "rrhh",
  jornadas: "rrhh",
  feriados: "rrhh",
  config_liquidacion: "rrhh",
  rrhh_import_batches: "rrhh",
  rrhh_import_staging: "rrhh",
  fichadas: "rrhh",
  calculos_diarios: "rrhh",
  ausencias: "rrhh",
  vacaciones: "rrhh",
  francos: "rrhh",
  liquidaciones: "rrhh",

  // ── Remises ──
  choferes: "remises",
  vehiculos: "remises",
  remises_turnos: "remises",
  remises_empleados_datos: "remises",
  remises_asistencia: "remises",
  remises_plan_semana: "remises",
  remises_plantillas: "remises",
  remises_plantillas_grupos: "remises",
  remises_config: "remises",
  remises_push_tokens: "remises",
  hojas_ruta: "remises",
  asientos: "remises",

  // ── Mantenimiento ──
  equipos: "mantenimiento",
  equipos_checklists: "mantenimiento",
  equipos_status_log: "mantenimiento",
  equipos_tipos: "mantenimiento",
  equipos_componentes: "mantenimiento",
  equipos_repuestos: "mantenimiento",
  mantenimientos_programados: "mantenimiento",
  mantenimientos_ejecuciones: "mantenimiento",
  mantenimiento_tarifas_hora: "mantenimiento",
  ordenes_trabajo: "mantenimiento",
  ordenes_trabajo_repuestos: "mantenimiento",
  planificacion_diaria: "mantenimiento",
  planificacion_diaria_items: "mantenimiento",
  avisos: "mantenimiento",
  ordenes_servicio: "mantenimiento",
  os_comparativas: "mantenimiento",
  os_aprobadores: "mantenimiento",
  operarios: "mantenimiento",
  contratistas: "mantenimiento",
  produccion_semanal: "mantenimiento",

  // ── Compras ──
  compras_areas: "compras",
  compras_requerimientos: "compras",
  compras_cotizaciones: "compras",
  compras_historial: "compras",
  compras_sincronizaciones: "compras",
  compras_ubicaciones: "compras",
  compras_aprobadores: "compras",
  compras_odoo_ordenes: "compras",
  compras_producto_odoo: "compras",
  usuario_areas_compras: "compras",

  // ── Inventario ──
  inventario_articulos: "inventario",
  inventario_movimientos: "inventario",
  inventario_destinos: "inventario",
  inventario_solicitantes: "inventario",
  inventario_equipos: "inventario",

  // ── Producción ──
  produccion_partes: "produccion",
  produccion_productos: "produccion",
  produccion_renglon_productos: "produccion",
  produccion_deposito: "produccion",
  produccion_despachos: "produccion",

  // ── Despacho ──
  despacho_ordenes_carga: "despacho",
  despacho_productos: "despacho",
  despacho_recepciones: "despacho",
  despacho_recepcion_proveedores: "despacho",

  // ── Facturación ──
  facturas_proveedor: "facturacion",
  facturas_proveedor_lineas: "facturacion",

  // ── Cantera ──
  cantera_yacimientos: "cantera",
  cantera_voladuras: "cantera",
  cantera_bochones: "cantera",
  cantera_insumos: "cantera",
  cantera_consumos: "cantera",
  cantera_contratistas: "cantera",
  cantera_finanzas: "cantera",
};

/** Null si nadie la mapeó — y entonces no se le muestra a nadie. */
export function moduloDe(tabla: string): Ambito | null {
  return MODULO_DE_TABLA[tabla] ?? null;
}

/**
 * Las tablas que un usuario con estos módulos puede ver nombradas.
 *
 * El mapa entra por parámetro para que `armarCatalogo` pueda testearse con uno
 * de juguete sin duplicar este filtro. Es la única definición de "qué ve quién"
 * del lado del prompt: si aparece una segunda, una de las dos va a quedar vieja.
 */
export function tablasVisibles(
  modulos: Modulo[],
  mapa: Record<string, Ambito> = MODULO_DE_TABLA
): string[] {
  const suyos = new Set<Ambito>([...modulos, "nucleo"]);
  return Object.keys(mapa)
    .filter((t) => suyos.has(mapa[t]))
    .sort();
}
```

> **Nota para quien ejecuta:** `asistente_consultas` queda **fuera** del mapa a
> propósito. El asistente no necesita poder consultar su propia bitácora, y que
> no pueda evita el bucle bobo de que alguien le pregunte qué preguntaron otros.

- [ ] **Paso 4: Correr el test**

```bash
npx vitest run lib/asistente/modulos.test.ts
```

Esperado: PASS, 6 tests.

- [ ] **Paso 5: Commit**

```bash
git add lib/asistente/modulos.ts lib/asistente/modulos.test.ts
git commit -m "feat(asistente): que tabla es de que modulo, cerrando por defecto"
```

---

### Tarea 7: El generador del catálogo

**Archivos:**
- Crear: `scripts/generar-catalogo-asistente.mjs`
- Modificar: `package.json` (script `catalogo`)
- Genera: `lib/asistente/catalogo.generado.json`

- [ ] **Paso 1: Escribir el script**

```js
#!/usr/bin/env node
/**
 * Escribe `lib/asistente/catalogo.generado.json` leyendo el esquema real.
 *
 *   npm run catalogo
 *
 * Se genera y no se escribe a mano porque el esquema está nombrado en tres
 * épocas: `empleados` tiene nombre/apellido/activo y `equipos` tiene
 * name/code/is_active, que viene del sistema en inglés que renombró la 029.
 * Escrito a mano, una columna se copia mal una vez y el error queda escondido
 * — y un SQL con la columna equivocada no falla: devuelve filas, sólo que las
 * que no son.
 *
 * Al final reporta las tablas que `lib/asistente/modulos.ts` no mapeó. Esas no
 * se le muestran a nadie: el mapa cierra por defecto. El reporte existe para
 * que la tabla nueva de la semana que viene no quede invisible para siempre.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { MODULO_DE_TABLA } from "../lib/asistente/modulos.ts";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Una sola consulta por cosa, con la service role: esto corre en la máquina de
// quien desarrolla, no en producción.
const { data, error } = await db.rpc("asistente_consulta", {
  consulta: `
    select
      c.table_name  as tabla,
      c.column_name as columna,
      c.data_type   as tipo,
      c.is_nullable as nuleable,
      c.udt_name    as udt
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
    order by c.table_name, c.ordinal_position
  `,
  tope: 1000,
});

if (error) {
  console.error("No se pudo leer el esquema:", error.message);
  process.exit(1);
}

const tablas = {};
for (const f of data) {
  (tablas[f.tabla] ??= []).push({
    columna: f.columna,
    tipo: f.udt?.startsWith("_") ? `${f.udt.slice(1)}[]` : f.udt ?? f.tipo,
    nuleable: f.nuleable === "YES",
  });
}

// Los valores de cada enum: sin esto el modelo inventa estados.
const { data: enums, error: errorEnums } = await db.rpc("asistente_consulta", {
  consulta: `
    select t.typname as nombre, e.enumlabel as valor
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
    order by t.typname, e.enumsortorder
  `,
  tope: 1000,
});
if (errorEnums) {
  console.error("No se pudieron leer los enums:", errorEnums.message);
  process.exit(1);
}

const valoresDeEnum = {};
for (const e of enums) (valoresDeEnum[e.nombre] ??= []).push(e.valor);

const destino = new URL("../lib/asistente/catalogo.generado.json", import.meta.url);
writeFileSync(destino, JSON.stringify({ tablas, enums: valoresDeEnum }, null, 2) + "\n", "utf8");

const sinMapear = Object.keys(tablas).filter((t) => !MODULO_DE_TABLA[t]);
console.log(`Escrito: ${Object.keys(tablas).length} tablas, ${Object.keys(valoresDeEnum).length} enums.`);
if (sinMapear.length) {
  console.log(`\nSin mapear en lib/asistente/modulos.ts (${sinMapear.length}) — no se le muestran a nadie:`);
  for (const t of sinMapear) console.log(`  ${t}`);
}
```

- [ ] **Paso 2: Agregar el script a package.json**

En `"scripts"`, después de `"migracion"`:

```json
"catalogo": "npx tsx scripts/generar-catalogo-asistente.mjs"
```

> `tsx` y no `node` porque el script importa `lib/asistente/modulos.ts`. Es el
> mismo camino que ya usan `scripts/comparar-despacho.mts` y los demás.

- [ ] **Paso 3: Correrlo**

```bash
npm run catalogo
```

Esperado: `Escrito: N tablas, M enums.` y, abajo, la lista de tablas sin mapear.

- [ ] **Paso 4: Revisar el reporte y completar el mapa**

Mirá la lista de "sin mapear". Para cada una, decidí su módulo y agregala a
`lib/asistente/modulos.ts`. Las que deban quedar fuera a propósito (como
`asistente_consultas`) dejalas, pero **anotalas en el comentario del archivo**
para que la próxima corrida no vuelva a plantear la duda.

Volvé a correr `npm run catalogo` hasta que el reporte sólo tenga las
deliberadas.

- [ ] **Paso 5: Commit**

```bash
git add scripts/generar-catalogo-asistente.mjs package.json lib/asistente/catalogo.generado.json lib/asistente/modulos.ts
git commit -m "feat(asistente): el catalogo del esquema se genera de la base, no se escribe a mano"
```

---

### Tarea 8: Armar el catálogo del usuario

**Archivos:**
- Crear: `lib/asistente/notas.ts`
- Crear: `lib/asistente/catalogo.ts`
- Test: `lib/asistente/catalogo.test.ts`

- [ ] **Paso 1: Escribir el test que falla**

```ts
import { describe, it, expect } from "vitest";
import { armarCatalogo, catalogoPara, type EsquemaCrudo } from "./catalogo";
import type { Ambito } from "./modulos";

const ESQUEMA: EsquemaCrudo = {
  tablas: {
    empleados: [
      { columna: "id", tipo: "uuid", nuleable: false },
      { columna: "nombre", tipo: "text", nuleable: false },
      { columna: "activo", tipo: "bool", nuleable: false },
    ],
    liquidaciones: [
      { columna: "id", tipo: "uuid", nuleable: false },
      { columna: "periodo", tipo: "text", nuleable: false },
    ],
    equipos: [
      { columna: "id", tipo: "uuid", nuleable: false },
      { columna: "name", tipo: "text", nuleable: false },
      { columna: "is_active", tipo: "bool", nuleable: false },
    ],
    tabla_huerfana: [{ columna: "id", tipo: "uuid", nuleable: false }],
  },
  enums: { user_role: ["admin_sistema", "encargado", "operario"] },
};

const MAPA: Record<string, Ambito> = {
  empleados: "nucleo",
  liquidaciones: "rrhh",
  equipos: "mantenimiento",
};

describe("el catálogo que ve cada usuario", () => {
  it("incluye sus módulos y el núcleo", () => {
    const texto = armarCatalogo(ESQUEMA, MAPA, {}, ["mantenimiento"]);
    expect(texto).toContain("equipos");
    expect(texto).toContain("empleados");
  });

  /**
   * Lo importante no es que no pueda leerla —de eso se ocupa RLS— sino que ni
   * siquiera sepa que existe: un modelo que no ve el nombre no escribe la
   * consulta, y no gastamos un intento en que la base devuelva vacío.
   */
  it("no nombra las tablas de un módulo que el usuario no tiene", () => {
    const texto = armarCatalogo(ESQUEMA, MAPA, {}, ["mantenimiento"]);
    expect(texto).not.toContain("liquidaciones");
  });

  it("no nombra una tabla sin mapear, para nadie", () => {
    const texto = armarCatalogo(ESQUEMA, MAPA, {}, ["rrhh", "mantenimiento"]);
    expect(texto).not.toContain("tabla_huerfana");
  });

  it("muestra el tipo y si admite null", () => {
    const texto = armarCatalogo(ESQUEMA, MAPA, {}, ["mantenimiento"]);
    expect(texto).toContain("name text");
  });

  it("pega la nota escrita a mano debajo de la tabla", () => {
    const notas = { equipos: "Viene del sistema en inglés: name, no nombre." };
    const texto = armarCatalogo(ESQUEMA, MAPA, notas, ["mantenimiento"]);
    expect(texto).toContain("Viene del sistema en inglés");
  });

  it("no pega la nota de una tabla que no se muestra", () => {
    const notas = { liquidaciones: "Sólo admin de RRHH." };
    const texto = armarCatalogo(ESQUEMA, MAPA, notas, ["mantenimiento"]);
    expect(texto).not.toContain("Sólo admin de RRHH");
  });

  it("sin módulos, sigue habiendo núcleo", () => {
    const texto = armarCatalogo(ESQUEMA, MAPA, {}, []);
    expect(texto).toContain("empleados");
    expect(texto).not.toContain("equipos");
  });

  // Con los datos de verdad, no con los de juguete.
  it("el catálogo real de un usuario de compras no menciona liquidaciones", () => {
    const texto = catalogoPara(["compras"]);
    expect(texto).toContain("compras_requerimientos");
    expect(texto).not.toContain("liquidaciones");
  });
});
```

- [ ] **Paso 2: Correr para verificar que falla**

```bash
npx vitest run lib/asistente/catalogo.test.ts
```

Esperado: FAIL — no existe el módulo.

- [ ] **Paso 3: Escribir las notas**

`lib/asistente/notas.ts`:

```ts
/**
 * Lo que el esquema no dice y el modelo no puede adivinar.
 *
 * El catálogo generado tiene nombres y tipos; esto tiene el significado y las
 * trampas. Es lo único de todo el asistente que se escribe a mano a propósito:
 * son exactamente las cosas que un desarrollador nuevo también pregunta.
 *
 * Se agrega de a poco, con las preguntas que salieron mal en la mano. Una tabla
 * sin nota no rompe nada.
 */
export const NOTAS: Record<string, string> = {
  equipos:
    "Las máquinas de planta. Viene del sistema en inglés que renombró la 029: las " +
    "columnas son `name`, `code` e `is_active`, NO nombre/codigo/activo.",

  compras_requerimientos:
    "Los pedidos de materiales (RI). **El estado son dos campos y no uno**: " +
    "`estado_aprobacion` (si lo aprobaron) y `estado_compra` (en qué punto del " +
    "circuito está). Preguntar por 'pendientes' casi siempre es " +
    "estado_aprobacion = 'PENDIENTE'. `nro_ri` es el número que usa la gente.",

  productos:
    "El catálogo único que comparten Producción y Despacho. `kg_por_unidad` puede " +
    "ser null a propósito: la bolsa son 25 kg y el bolsón sigue sin confirmar. " +
    "`odoo_product_id` en null es un producto que Odoo no vende con ese nombre.",

  inventario_articulos:
    "El pañol. Son unos 2.800, así que conviene filtrar por `codigo` o por " +
    "`descripcion ilike`, no traerlos todos.",

  inventario_movimientos:
    "Entradas y salidas del pañol. `fecha` puede faltar: el kardex de la planilla " +
    "no siempre la trae, y se dejó nullable en vez de inventarla.",

  avisos:
    "El primer eslabón de Mantenimiento: alguien vio que algo anda mal. De un aviso " +
    "sale después una orden de trabajo.",

  ordenes_trabajo:
    "Las OT. `created_by` y los demás campos de persona apuntan a `usuarios`, no a " +
    "`empleados`.",

  despacho_ordenes_carga:
    "Cada camión que entró al predio. Los tiempos de carga y de permanencia son " +
    "restas entre las horas, no columnas guardadas.",

  produccion_partes:
    "Un parte por fecha y turno. Los turnos son '4_12' y '12_20'.",

  facturas_proveedor:
    "El buzón de facturas de proveedor. El SdG propone y Odoo confirma: un asiento " +
    "posteado es inmutable y no se deshace desde el sistema.",

  empleados:
    "Catálogo del núcleo, compartido por los nueve módulos. Columnas en castellano: " +
    "`nombre`, `apellido`, `legajo`, `activo`.",
};

/**
 * Lo que vale para todo el esquema y no para una tabla.
 *
 * Va arriba del catálogo, una sola vez.
 */
export const NOTAS_GENERALES = `
- Un enlace (columna que termina en _id) en NULL significa "no se reconoció con
  certeza", no "no hay". En este sistema se prefiere dejar en null antes que
  enlazar a lo que se le parece.
- Casi todas las tablas tienen \`activo\` o \`is_active\`: salvo que pregunten por
  histórico, filtrá por los activos.
- Las fechas son date o timestamptz según la tabla. Para agrupar por mes:
  date_trunc('month', fecha::timestamp) — el cast explícito hace falta.
`.trim();
```

- [ ] **Paso 4: Implementar el armado**

`lib/asistente/catalogo.ts`:

```ts
import type { Modulo } from "@/lib/core/types";
import { MODULO_DE_TABLA, tablasVisibles, type Ambito } from "./modulos";
import { NOTAS, NOTAS_GENERALES } from "./notas";
import crudo from "./catalogo.generado.json";

export interface ColumnaCruda {
  columna: string;
  tipo: string;
  nuleable: boolean;
}

export interface EsquemaCrudo {
  tablas: Record<string, ColumnaCruda[]>;
  enums: Record<string, string[]>;
}

/**
 * El esquema que se le muestra a un usuario, en texto.
 *
 * Puro y con todo por parámetro, para poder testearlo con un esquema de
 * juguete: si dependiera del JSON generado, el test cambiaría cada vez que
 * alguien agrega una columna, y un test que se rompe solo deja de leerse.
 *
 * Lo que decide qué entra es `tablasVisibles`: los módulos del usuario más el
 * núcleo, y nada sin mapear. Recordar que **esto no es la barrera** — la
 * barrera es que la consulta corre con la sesión del usuario y RLS.
 */
export function armarCatalogo(
  esquema: EsquemaCrudo,
  mapa: Record<string, Ambito>,
  notas: Record<string, string>,
  modulos: Modulo[]
): string {
  // El filtro vive en `tablasVisibles` y no acá: dos copias de "qué ve quién"
  // es una que va a quedar vieja.
  const tablas = tablasVisibles(modulos, mapa).filter((t) => esquema.tablas[t]);

  const bloques = tablas.map((t) => {
    const columnas = esquema.tablas[t]
      .map((c) => `  ${c.columna} ${c.tipo}${c.nuleable ? " null" : ""}`)
      .join("\n");
    const nota = notas[t] ? `\n  -- ${notas[t].replace(/\n/g, "\n  -- ")}` : "";
    return `${t}:\n${columnas}${nota}`;
  });

  // Sólo los enums que alguna columna visible usa: el resto es ruido.
  const tiposUsados = new Set(
    tablas.flatMap((t) => esquema.tablas[t].map((c) => c.tipo.replace(/\[\]$/, "")))
  );
  const enums = Object.entries(esquema.enums)
    .filter(([nombre]) => tiposUsados.has(nombre))
    .map(([nombre, valores]) => `${nombre}: ${valores.join(" | ")}`);

  return [
    NOTAS_GENERALES,
    "",
    "TABLAS",
    bloques.join("\n\n"),
    enums.length ? `\nENUMS\n${enums.join("\n")}` : "",
  ].join("\n");
}

/** El catálogo real, con los datos generados. */
export function catalogoPara(modulos: Modulo[]): string {
  return armarCatalogo(crudo as EsquemaCrudo, MODULO_DE_TABLA, NOTAS, modulos);
}
```

- [ ] **Paso 5: Habilitar la importación del JSON**

Verificá que `tsconfig.json` tenga `"resolveJsonModule": true`. Si no lo tiene,
agregalo dentro de `compilerOptions`.

```bash
grep -n resolveJsonModule tsconfig.json
```

- [ ] **Paso 6: Correr el test**

```bash
npx vitest run lib/asistente/catalogo.test.ts
```

Esperado: PASS, 8 tests.

- [ ] **Paso 7: Ver cuánto ocupa de verdad**

El tamaño del catálogo es el costo de cada pregunta, así que conviene medirlo y
no estimarlo:

```bash
npx tsx -e "import {catalogoPara} from './lib/asistente/catalogo.ts'; for (const m of ['compras','rrhh','mantenimiento']) console.log(m, catalogoPara([m]).length, 'chars')"
```

Anotá los números. Si un módulo solo pasa de ~40.000 caracteres (~10k tokens),
decíselo al usuario: es señal de que las notas están de más o de que conviene
recortar columnas de auditoría (`created_at`, `updated_at`) del catálogo.

- [ ] **Paso 8: Commit**

```bash
git add lib/asistente/catalogo.ts lib/asistente/catalogo.test.ts lib/asistente/notas.ts
git commit -m "feat(asistente): el catalogo que ve cada usuario, filtrado por sus modulos"
```

---

## Fase 2 — El backend

### Tarea 9: Ejecutar la consulta contra la base

**Archivos:**
- Crear: `lib/asistente/consulta.ts`
- Test: `lib/asistente/consulta.test.ts`
- Borrar: `scripts/tmp-probar-asistente-consulta.mts`

- [ ] **Paso 1: Escribir el test que falla**

Éste **sí toca la base**, y es a propósito: es la única forma de comprobar que la
transacción de sólo lectura hace lo que decimos.

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { correrConsulta } from "./consulta";

for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const email = process.env.ASISTENTE_TEST_EMAIL;
const password = process.env.ASISTENTE_TEST_PASSWORD;

/**
 * Se saltea si no hay usuario de prueba configurado: el resto de la suite
 * tiene que poder correr en cualquier máquina y en CI sin credenciales.
 */
const cuando = email && password ? describe : describe.skip;

cuando("la consulta contra la base real", () => {
  let db: SupabaseClient;

  beforeAll(async () => {
    db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { error } = await db.auth.signInWithPassword({ email: email!, password: password! });
    if (error) throw new Error(`No se pudo entrar con el usuario de prueba: ${error.message}`);
  });

  it("devuelve filas de un select", async () => {
    const r = await correrConsulta(db, "select count(*) as n from empresas");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.filas.length).toBe(1);
  });

  /**
   * El test que justifica todo el diseño — y que hay que escribir con cuidado,
   * porque la versión obvia no prueba nada.
   *
   * Mandar un `update` NO sirve: lo rechaza el guard de texto antes de salir.
   * Un CTE que escribe (`with x as (update …) select …`) tampoco: lo rechaza el
   * envoltorio `select * from (…) sub` de la función, porque un CTE que
   * modifica tiene que estar en el nivel superior. Las dos cosas dan verde por
   * la razón equivocada.
   *
   * Lo único que mide la barrera de verdad es preguntarle a la transacción en
   * qué modo está. Medido el 16/09/2026: da `on`, y da `on` **también por
   * POST** — porque PostgREST corre en sólo lectura toda función `stable`, no
   * sólo los GET. La declaración `stable` es lo que sostiene; `get: true` es
   * honesto pero no es lo que salva.
   *
   * Si este test se pone rojo, alguien le sacó el `stable` a la función y el
   * asistente dejó de ser de sólo lectura sin que nada más lo note.
   */
  it("la consulta corre en una transacción de sólo lectura", async () => {
    const r = await correrConsulta(db, "select current_setting('transaction_read_only') as modo");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.filas[0]).toEqual({ modo: "on" });
  });

  it("el guard de texto rechaza una escritura antes de salir", async () => {
    const r = await correrConsulta(db, "update empresas set nombre = nombre");
    expect(r.ok).toBe(false);
  });

  it("rechaza dos sentencias", async () => {
    const r = await correrConsulta(db, "select 1 as n; update empresas set nombre = nombre");
    expect(r.ok).toBe(false);
  });

  it("una tabla de otro módulo devuelve vacío y no un error: eso es RLS", async () => {
    const r = await correrConsulta(db, "select count(*) as n from liquidaciones");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.filas[0]).toEqual({ n: 0 });
  });

  it("devuelve el error de Postgres sin traducir", async () => {
    const r = await correrConsulta(db, "select columna_que_no_existe from empresas");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/does not exist/i);
  });
});
```

> **Antes de correrlo:** agregá a `.env.local` un usuario de prueba **sin RRHH**:
> ```
> ASISTENTE_TEST_EMAIL=...
> ASISTENTE_TEST_PASSWORD=...
> ```
> Si no está, el bloque se saltea y el test no falla. Decíselo al usuario y pedí
> las credenciales: sin esto, la propiedad central del diseño queda sin verificar.

- [ ] **Paso 2: Correr para verificar que falla**

```bash
npx vitest run lib/asistente/consulta.test.ts
```

Esperado: FAIL — no existe `./consulta`.

- [ ] **Paso 3: Implementar**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { validarConsulta } from "./validarConsulta";

export type Resultado =
  | { ok: true; filas: Record<string, unknown>[] }
  | { ok: false; error: string };

/** Cuántas filas vuelven como mucho. Más que esto no entra en una respuesta. */
export const TOPE_DE_FILAS = 200;

/**
 * Corre una consulta del asistente con la sesión de quien preguntó.
 *
 * Tres cosas que no son casuales:
 *
 * 1. **El cliente es el del usuario**, nunca `createAdminClient()`. Es lo único
 *    que hace que RLS decida qué ve cada uno. Si algún día alguien cambia esto
 *    por "no me devolvía nada", rompió el diseño entero.
 * 2. **`{ get: true }`**. PostgREST corre los GET en una transacción de sólo
 *    lectura: ahí es donde muere un UPDATE. Sin esto la función es un agujero.
 * 3. **El error vuelve tal cual lo dijo Postgres**, sin traducir. El modelo lo
 *    usa para corregir en el intento siguiente —"column does not exist" le dice
 *    exactamente qué arreglar— y la persona lo ve si no salió. Misma regla que
 *    los errores de Google: un diagnóstico que no se distingue de otro no es un
 *    diagnóstico.
 */
export async function correrConsulta(
  db: SupabaseClient,
  sql: string,
  tope: number = TOPE_DE_FILAS
): Promise<Resultado> {
  const veredicto = validarConsulta(sql);
  if (!veredicto.ok) return { ok: false, error: veredicto.motivo };

  const { data, error } = await db.rpc(
    "asistente_consulta",
    { consulta: sql, tope },
    { get: true }
  );

  if (error) return { ok: false, error: error.message };
  return { ok: true, filas: (data ?? []) as Record<string, unknown>[] };
}
```

- [ ] **Paso 4: Correr el test**

```bash
npx vitest run lib/asistente/consulta.test.ts
```

Esperado: PASS, 5 tests. Si salen como `skipped`, faltan las credenciales del
paso 1 — pedilas antes de seguir.

- [ ] **Paso 5: Borrar el script temporal**

```bash
rm scripts/tmp-probar-asistente-consulta.mts
```

- [ ] **Paso 6: Commit**

```bash
git add lib/asistente/consulta.ts lib/asistente/consulta.test.ts
git commit -m "feat(asistente): la consulta corre con la sesion del usuario y por GET

El test que importa es el del UPDATE rechazado: leer que PostgREST usa
transaccion de solo lectura no alcanza, hay que correr la operacion final."
```

---

### Tarea 10: El modelo y el prompt

**Archivos:**
- Modificar: `package.json` (dependencias)
- Crear: `lib/asistente/prompt.ts`
- Test: `lib/asistente/prompt.test.ts`
- Modificar: `docs/VARIABLES-VERCEL.md`

- [ ] **Paso 1: Instalar el AI SDK**

```bash
npm install ai @ai-sdk/react zod
```

> `zod` va porque los `inputSchema` de las herramientas del AI SDK lo usan.
>
> Sin paquete de proveedor: el modelo se nombra como string
> (`"anthropic/claude-sonnet-5"`) y lo resuelve **Vercel AI Gateway**. Es lo
> recomendado en Vercel y evita atarse a un proveedor.

- [ ] **Paso 2: Escribir el test que falla**

```ts
import { describe, it, expect } from "vitest";
import { systemPrompt } from "./prompt";

describe("el system prompt", () => {
  it("mete el catálogo del usuario", () => {
    const p = systemPrompt({ catalogo: "TABLAS\nempleados:\n  id uuid", pantalla: null, hoy: "2026-09-16" });
    expect(p).toContain("empleados");
  });

  it("dice en qué pantalla está parado, cuando lo sabe", () => {
    const p = systemPrompt({ catalogo: "x", pantalla: "/compras/requerimientos", hoy: "2026-09-16" });
    expect(p).toContain("/compras/requerimientos");
  });

  it("no inventa una pantalla cuando no la sabe", () => {
    const p = systemPrompt({ catalogo: "x", pantalla: null, hoy: "2026-09-16" });
    expect(p).not.toContain("está mirando la pantalla");
  });

  it("le dice la fecha, porque 'este mes' depende de eso", () => {
    const p = systemPrompt({ catalogo: "x", pantalla: null, hoy: "2026-09-16" });
    expect(p).toContain("2026-09-16");
  });

  it("le da permiso explícito para no saber", () => {
    const p = systemPrompt({ catalogo: "x", pantalla: null, hoy: "2026-09-16" });
    expect(p.toLowerCase()).toContain("no sé");
  });
});
```

- [ ] **Paso 3: Correr para verificar que falla**

```bash
npx vitest run lib/asistente/prompt.test.ts
```

Esperado: FAIL — no existe `./prompt`.

- [ ] **Paso 4: Implementar**

```ts
/**
 * Lo que el asistente sabe antes de que le pregunten.
 *
 * Es puro y se testea: el prompt es la parte del sistema que más se toca y la
 * que más fácil se rompe sin que nadie lo note. Un test que verifica que el
 * catálogo entró y que la fecha está es barato y atrapa el día que alguien
 * refactorea y deja el catálogo afuera.
 */
export function systemPrompt({
  catalogo,
  pantalla,
  hoy,
}: {
  catalogo: string;
  pantalla: string | null;
  hoy: string;
}): string {
  const contexto = pantalla
    ? `\nQuien pregunta está mirando la pantalla ${pantalla}. Si la pregunta es ambigua ("¿cuántos hay pendientes?"), interpretala en ese contexto y decí cómo la interpretaste.\n`
    : "";

  return `Sos el asistente del SdG, el sistema de gestión de Polcecal y Polysan.
Contestás **únicamente** con datos del sistema y con su documentación. No usás
conocimiento general ni inventás nada. Escribís en castellano rioplatense, corto
y sin vueltas.

Hoy es ${hoy}.
${contexto}
## Cómo contestás preguntas de datos

Usás la herramienta \`consultar\` con SQL de PostgreSQL sobre el esquema de abajo.

- Devolvé **sólo SELECT o WITH**. No podés escribir: la base lo rechaza.
- Si la consulta falla, leé el error y corregí. Tenés **tres intentos**.
- Si a los tres intentos no sale, decí **"no sé"** y mostrá qué intentaste. Un
  "no sé" es infinitamente mejor que un número inventado: quien pregunta va a
  tomar una decisión con eso.
- Poné siempre un límite razonable y ordená por lo que tenga sentido.
- Cuando cuentes o sumes, decí **sobre qué filas**: qué filtro pusiste. Un número
  sin su filtro no se puede verificar.

## Cómo contestás preguntas de cómo se usa el sistema

Con \`leer_documento\`. Elegí el documento por su nombre y citá de dónde sacaste
lo que decís.

## Cuándo armás una carga

Si piden cargar algo, usá \`armar_carga\`: devuelve un enlace al formulario de
siempre, con los campos puestos. **Vos no guardás nada** — lo confirma una
persona.

- Sólo altas nuevas. No cambiás estados de nada.
- Si no reconocés un artículo, un equipo o un área **con certeza**, dejá el campo
  vacío y decilo. En este sistema, enlazar a lo que se le parece es peor que
  dejar en null: un enlace equivocado no se nota nunca.
- Para un movimiento de inventario, \`articulo\` es el **id (uuid)** de
  \`inventario_articulos\`, no el código ni la descripción: la pantalla lo busca
  por id. Buscalo antes con \`consultar\` y usá ese id. Si la búsqueda trae más
  de un artículo parecido, **no elijas vos**: mostrá los candidatos y dejá que
  la persona diga cuál.
- El área del requerimiento y quién paga no se precargan. Son decisiones de quien
  pide.

## El esquema que podés consultar

Es sólo lo que quien pregunta tiene permitido ver. Si algo no está acá, no
existe para esta conversación — no lo consultes ni lo menciones.

${catalogo}`;
}
```

- [ ] **Paso 5: Correr el test**

```bash
npx vitest run lib/asistente/prompt.test.ts
```

Esperado: PASS, 5 tests.

- [ ] **Paso 6: Documentar la variable de entorno**

Agregá a `docs/VARIABLES-VERCEL.md`, siguiendo el formato que ya tiene el
archivo, una entrada para:

```
AI_GATEWAY_API_KEY — La llave del Vercel AI Gateway, que es por donde el
asistente habla con el modelo. En Vercel, si el proyecto tiene el Gateway
habilitado, se inyecta sola vía OIDC y no hace falta cargarla; en local sí, y se
saca del panel de Vercel (AI Gateway → API keys). Sin ella la ruta
/api/asistente devuelve el error del proveedor tal cual, que es lo que
corresponde.
```

- [ ] **Paso 7: Commit**

```bash
git add package.json package-lock.json lib/asistente/prompt.ts lib/asistente/prompt.test.ts docs/VARIABLES-VERCEL.md
git commit -m "feat(asistente): el prompt, con permiso explicito para decir que no sabe"
```

---

### Tarea 11: Las herramientas y la ruta

**Archivos:**
- Crear: `lib/asistente/documentos.ts`
- Test: `lib/asistente/documentos.test.ts`
- Crear: `app/api/asistente/route.ts`

- [ ] **Paso 1: Escribir el test de los documentos**

```ts
import { describe, it, expect } from "vitest";
import { documentosPara, rutaDelDocumento } from "./documentos";

describe("qué documentación puede leer cada uno", () => {
  it("le ofrece los de sus módulos", () => {
    const docs = documentosPara(["compras"]);
    expect(docs).toContain("COMPRAS.md");
    expect(docs).not.toContain("RRHH-ACTUALIZACION.md");
  });

  it("los generales los ve cualquiera", () => {
    expect(documentosPara([])).toContain("NUCLEO-COMPARTIDO.md");
  });

  it("resuelve la ruta de un documento permitido", () => {
    expect(rutaDelDocumento("COMPRAS.md", ["compras"])).toBe("docs/COMPRAS.md");
  });

  it("no resuelve uno de un módulo que no tiene", () => {
    expect(rutaDelDocumento("RRHH-ACTUALIZACION.md", ["compras"])).toBeNull();
  });

  /**
   * El modelo escribe el nombre del documento, así que es entrada no confiable:
   * sin esto, un "../.env.local" lee un archivo de secretos.
   */
  it("no deja salir de docs/", () => {
    expect(rutaDelDocumento("../.env.local", ["compras"])).toBeNull();
    expect(rutaDelDocumento("../../etc/passwd", ["compras"])).toBeNull();
  });
});
```

- [ ] **Paso 2: Correr para verificar que falla**

```bash
npx vitest run lib/asistente/documentos.test.ts
```

Esperado: FAIL — no existe `./documentos`.

- [ ] **Paso 3: Implementar los documentos**

```ts
import type { Modulo } from "@/lib/core/types";
import type { Ambito } from "./modulos";

/**
 * Qué documento de `docs/` puede leer cada usuario.
 *
 * Los documentos son técnicos y describen el sistema, no los datos, así que el
 * riesgo es bajo — pero se filtran igual por los mismos módulos que las tablas,
 * porque algunos traen ejemplos con datos reales y porque una regla que vale
 * para una mitad y no para la otra es una regla que alguien va a leer mal.
 *
 * La lista es explícita y no un `readdir`: un documento nuevo no queda visible
 * por descuido. Si falta uno, se agrega acá.
 */
const AMBITO_DEL_DOCUMENTO: Record<string, Ambito> = {
  "NUCLEO-COMPARTIDO.md": "nucleo",
  "AUTENTICACION.md": "nucleo",
  "BACKUPS.md": "nucleo",
  "VARIABLES-VERCEL.md": "nucleo",
  "ODOO-INTEGRACION.md": "nucleo",
  "COMPRAS.md": "compras",
  "COMPRAS-ESTADO.md": "compras",
  "COMPRAS-SINCRONIZACION.md": "compras",
  "COMPRAS-ANALISIS-PLANILLA.md": "compras",
  "COMPRAS-PROVEEDORES-ODOO.md": "compras",
  "MANTENIMIENTO-INTEGRACION.md": "mantenimiento",
  "RRHH-ACTUALIZACION.md": "rrhh",
  "RRHH-RENDIMIENTO.md": "rrhh",
  "PRODUCCION.md": "produccion",
  "DESPACHO.md": "despacho",
  "FACTURACION.md": "facturacion",
};

export function documentosPara(modulos: Modulo[]): string[] {
  const suyos = new Set<Ambito>([...modulos, "nucleo"]);
  return Object.keys(AMBITO_DEL_DOCUMENTO)
    .filter((d) => suyos.has(AMBITO_DEL_DOCUMENTO[d]))
    .sort();
}

/**
 * La ruta en disco de un documento, o null si no corresponde.
 *
 * El nombre lo escribe el modelo, así que es entrada no confiable: se compara
 * contra la lista, no se concatena. Sin esto, un "../.env.local" lee secretos.
 */
export function rutaDelDocumento(nombre: string, modulos: Modulo[]): string | null {
  if (!documentosPara(modulos).includes(nombre)) return null;
  return `docs/${nombre}`;
}
```

- [ ] **Paso 4: Correr el test**

```bash
npx vitest run lib/asistente/documentos.test.ts
```

Esperado: PASS, 5 tests.

- [ ] **Paso 5: Escribir la ruta**

`app/api/asistente/route.ts`:

```ts
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { streamText, tool, stepCountIs, convertToModelMessages, type UIMessage } from "ai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { modulosVisibles, puedeUsarAsistente } from "@/lib/core/access";
import { cuerpoJson } from "@/lib/core/cuerpo";
import type { Modulo, Rol, UsuarioModulo } from "@/lib/core/types";
import { catalogoPara } from "@/lib/asistente/catalogo";
import { systemPrompt } from "@/lib/asistente/prompt";
import { correrConsulta } from "@/lib/asistente/consulta";
import { documentosPara, rutaDelDocumento } from "@/lib/asistente/documentos";
import { urlDeCarga, type TipoDeCarga } from "@/lib/asistente/urlDeCarga";

/** Cuántas preguntas por día y por persona. El freno es de gasto, no de uso. */
const TOPE_DIARIO = 50;

export async function POST(request: Request) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("rol, activo, puede_usar_asistente")
    .eq("id", user.id)
    .single();

  if (!usuario?.activo) return NextResponse.json({ error: "Cuenta inactiva" }, { status: 403 });
  // `usuario.rol` viene sin tipar de Supabase: el cast es el mismo que hace el
  // layout y las demás rutas del núcleo.
  if (!puedeUsarAsistente({ rol: usuario.rol as Rol, puede_usar_asistente: usuario.puede_usar_asistente })) {
    return NextResponse.json(
      { error: "Todavía no tenés habilitado el asistente. Pedíselo a un administrador." },
      { status: 403 }
    );
  }

  // El tope del día. Se cuenta con la sesión del usuario: la policy de
  // `asistente_consultas` ya lo limita a sus propias filas.
  const desdeMedianoche = new Date();
  desdeMedianoche.setHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("asistente_consultas")
    .select("id", { count: "exact", head: true })
    .eq("usuario_id", user.id)
    .gte("creado_en", desdeMedianoche.toISOString());

  if ((count ?? 0) >= TOPE_DIARIO) {
    return NextResponse.json(
      { error: `Llegaste a las ${TOPE_DIARIO} preguntas de hoy. Mañana se renueva.` },
      { status: 429 }
    );
  }

  const body = await cuerpoJson(request);
  const mensajes = (body.messages ?? []) as UIMessage[];
  const pantalla = typeof body.pantalla === "string" ? body.pantalla : null;

  const { data: grants } = await supabase
    .from("usuario_modulos")
    .select("id, usuario_id, modulo, nivel")
    .eq("usuario_id", user.id);

  const modulos: Modulo[] = modulosVisibles(usuario.rol as Rol, (grants ?? []) as UsuarioModulo[]);

  // Lo que se guarda en la bitácora al terminar. Se va llenando en las tools.
  let ultimoSql: string | null = null;
  let ultimasFilas: number | null = null;
  let ultimoError: string | null = null;

  const resultado = streamText({
    model: "anthropic/claude-sonnet-5",
    system: systemPrompt({
      catalogo: catalogoPara(modulos),
      pantalla,
      hoy: new Date().toISOString().slice(0, 10),
    }),
    messages: convertToModelMessages(mensajes),
    // Tres intentos de consulta más la respuesta final. Sin techo, un modelo
    // que se traba reintenta hasta agotar el presupuesto.
    stopWhen: stepCountIs(6),
    tools: {
      consultar: tool({
        description:
          "Corre un SELECT de PostgreSQL contra el sistema y devuelve las filas. " +
          "Sólo lectura. Si falla, devuelve el error de Postgres para que lo corrijas.",
        inputSchema: z.object({
          sql: z.string().describe("La consulta. Sólo SELECT o WITH, una sola sentencia."),
        }),
        execute: async ({ sql }) => {
          ultimoSql = sql;
          const r = await correrConsulta(supabase, sql);
          if (!r.ok) {
            ultimoError = r.error;
            return { error: r.error };
          }
          ultimasFilas = r.filas.length;
          return { filas: r.filas, cuantas: r.filas.length };
        },
      }),

      leer_documento: tool({
        description:
          `Lee un documento técnico del sistema. Disponibles: ${documentosPara(modulos).join(", ")}`,
        inputSchema: z.object({ nombre: z.string() }),
        execute: async ({ nombre }) => {
          const ruta = rutaDelDocumento(nombre, modulos);
          if (!ruta) return { error: `No tenés acceso a "${nombre}" o no existe.` };
          try {
            return { contenido: await readFile(ruta, "utf-8") };
          } catch (e) {
            // Sin traducir, igual que el resto de los errores del sistema.
            return { error: e instanceof Error ? e.message : String(e) };
          }
        },
      }),

      armar_carga: tool({
        description:
          "Devuelve el enlace al formulario del sistema con los campos puestos, para que " +
          "una persona lo confirme. No guarda nada.",
        inputSchema: z.object({
          tipo: z.enum(["requerimiento", "movimiento", "aviso", "parte"]),
          campos: z.record(z.string(), z.string()),
        }),
        execute: async ({ tipo, campos }) => {
          const r = urlDeCarga(tipo as TipoDeCarga, campos);
          return r.ok ? { url: r.url } : { error: r.motivo };
        },
      }),
    },

    onFinish: async ({ usage }) => {
      // La bitácora corta el gasto y dice qué se pregunta de verdad. Si falla,
      // no se rompe la respuesta: ya se la llevó quien preguntó.
      const pregunta = mensajes[mensajes.length - 1];
      await supabase.from("asistente_consultas").insert({
        usuario_id: user.id,
        pregunta: JSON.stringify(pregunta?.parts ?? pregunta ?? "").slice(0, 2000),
        sql_corrido: ultimoSql,
        filas: ultimasFilas,
        tokens_entrada: usage?.inputTokens ?? null,
        tokens_salida: usage?.outputTokens ?? null,
        error: ultimoError,
      });
    },
  });

  return resultado.toUIMessageStreamResponse();
}
```

- [ ] **Paso 6: Verificar tipos**

```bash
npx tsc --noEmit
```

Esperado: sin errores. Si el AI SDK instalado difiere en algún nombre
(`stopWhen`, `inputSchema`, `toUIMessageStreamResponse`), **no lo adivines**:

```bash
npx tsc --noEmit 2>&1 | head -20
```

y consultá la documentación del SDK para la versión instalada
(`npm ls ai`) antes de tocar nada.

- [ ] **Paso 7: Commit**

```bash
git add lib/asistente/documentos.ts lib/asistente/documentos.test.ts app/api/asistente/route.ts
git commit -m "feat(asistente): la ruta, sus tres herramientas y el tope diario"
```

---

## Fase 3 — La pantalla

### Tarea 12: El panel

**Archivos:**
- Crear: `components/Asistente.tsx`
- Modificar: `components/Header.tsx`
- Modificar: `app/(app)/layout.tsx`

- [ ] **Paso 1: Escribir el panel**

`components/Asistente.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

/**
 * El asistente, como panel lateral sobre cualquier pantalla.
 *
 * Se abre con Ctrl+K (Cmd+K en Mac) o desde el botón del Header. Le manda al
 * backend en qué ruta está parado quien pregunta: con eso, "¿cuántos hay
 * pendientes?" desde Compras se entiende sin aclararlo.
 *
 * No hay pantalla completa a propósito. Es lo que se quiere a la larga, pero se
 * gana el lugar cuando las respuestas ya sean buenas.
 */
export function Asistente({ habilitado }: { habilitado: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const pathname = usePathname();

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/asistente" }),
  });

  useEffect(() => {
    if (!habilitado) return;
    function atajo(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAbierto((a) => !a);
      }
      if (e.key === "Escape") setAbierto(false);
    }
    window.addEventListener("keydown", atajo);
    return () => window.removeEventListener("keydown", atajo);
  }, [habilitado]);

  if (!habilitado) return null;

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!texto.trim()) return;
    sendMessage({ text: texto }, { body: { pantalla: pathname } });
    setTexto("");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        title="Preguntarle al sistema (Ctrl+K)"
        className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/10"
        style={{ color: "var(--sidebar-text)", background: "none", border: "none", cursor: "pointer" }}
      >
        <IconChispa />
      </button>

      {abierto && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onClick={() => setAbierto(false)}>
          <aside
            className="flex h-full w-full max-w-[520px] flex-col bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">Preguntarle al sistema</h2>
                <p className="text-xs text-gray-500">Sólo ve lo que vos podés ver.</p>
              </div>
              <button type="button" onClick={() => setAbierto(false)} className="text-gray-400 hover:text-gray-600">
                Cerrar
              </button>
            </header>

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {messages.length === 0 && (
                <p className="text-sm text-gray-500">
                  Preguntale por los datos del sistema o por cómo se usa. Por ejemplo:
                  <em> ¿cuántos requerimientos están pendientes de aprobación?</em>
                </p>
              )}
              {messages.map((m) => (
                <Mensaje key={m.id} mensaje={m} />
              ))}
              {status === "submitted" && <p className="text-sm text-gray-400">Pensando…</p>}
              {error && (
                // Sin traducir: un diagnóstico que no se distingue de otro no es
                // un diagnóstico. Misma regla que los errores de Google.
                <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">
                  {error.message}
                </p>
              )}
            </div>

            <form onSubmit={enviar} className="flex gap-2 border-t p-3">
              <input
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder="¿Qué querés saber?"
                className="input flex-1"
                autoFocus
              />
              <button type="submit" className="btn-primary" disabled={status !== "ready"}>
                Preguntar
              </button>
            </form>
          </aside>
        </div>
      )}
    </>
  );
}

/**
 * Un mensaje, con el SQL a la vista.
 *
 * Mostrar la consulta no es decoración: es lo único que convierte un número
 * equivocado en un número *detectablemente* equivocado. Con SQL generado, de vez
 * en cuando va a dar algo que parece bien y está mal.
 */
function Mensaje({ mensaje }: { mensaje: { role: string; parts?: unknown[] } }) {
  const esDeLaPersona = mensaje.role === "user";
  const partes = (mensaje.parts ?? []) as Array<Record<string, unknown>>;

  return (
    <div className={esDeLaPersona ? "text-right" : ""}>
      {partes.map((p, i) => {
        if (p.type === "text") {
          return (
            <p
              key={i}
              className={
                esDeLaPersona
                  ? "inline-block rounded-lg bg-slate-100 px-3 py-2 text-sm"
                  : "whitespace-pre-wrap text-sm text-gray-800"
              }
            >
              {String(p.text)}
            </p>
          );
        }

        if (p.type === "tool-consultar" && p.input) {
          const entrada = p.input as { sql?: string };
          const salida = p.output as { cuantas?: number; error?: string } | undefined;
          return (
            <details key={i} className="mt-2 rounded border border-slate-200 bg-slate-50 p-2 text-left">
              <summary className="cursor-pointer text-xs text-gray-500">
                {salida?.error
                  ? "La consulta falló"
                  : `Consulta · ${salida?.cuantas ?? "…"} filas`}
              </summary>
              <pre className="mt-2 overflow-x-auto text-xs text-gray-700">{entrada.sql}</pre>
              {salida?.error && <p className="mt-1 text-xs text-red-600">{salida.error}</p>}
            </details>
          );
        }

        if (p.type === "tool-armar_carga") {
          const salida = p.output as { url?: string; error?: string } | undefined;
          if (!salida?.url) return null;
          return (
            <Link key={i} href={salida.url} className="btn-primary mt-2 inline-block text-sm">
              Abrir el formulario con los datos puestos
            </Link>
          );
        }

        return null;
      })}
    </div>
  );
}

function IconChispa() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M12 3l1.8 4.9L18.7 9.7l-4.9 1.8L12 16.4l-1.8-4.9L5.3 9.7l4.9-1.8L12 3z" strokeLinejoin="round" />
      <path d="M18 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8L18 15z" strokeLinejoin="round" />
    </svg>
  );
}
```

- [ ] **Paso 2: Montarlo en el Header**

En `components/Header.tsx`, agregá el import y la prop:

```tsx
import { Asistente } from "./Asistente";
```

Cambiá la firma:

```tsx
export function Header({
  usuarioNombre,
  asistenteHabilitado,
}: {
  usuarioNombre: string;
  asistenteHabilitado: boolean;
}) {
```

Y en el bloque de la derecha, antes de `<NotificationsBell />`:

```tsx
      <div className="flex shrink-0 items-center gap-2">
        <Asistente habilitado={asistenteHabilitado} />
        <NotificationsBell />
```

- [ ] **Paso 3: Pasarle el permiso desde el layout**

En `app/(app)/layout.tsx`, agregá `puede_usar_asistente` al select del usuario:

```ts
  const { data: usuario } = await supabase
    .from("usuarios")
    .select("nombre, apellido, rol, empleado_id, activo, puede_usar_asistente")
    .eq("id", user.id)
    .single();
```

> **El `select` va en una sola cadena literal.** Partido con un `+`, Supabase
> pierde la inferencia de tipos. Es la trampa que el README de migraciones deja
> anotada y que la página de usuarios ya tiene comentada.

Importá `puedeUsarAsistente`:

```ts
import { modulosVisibles, nivelEnModulo, puedeUsarAsistente, MODULOS_ORDEN } from "@/lib/core/access";
```

Y pasásela al Header:

```tsx
          <Header
            usuarioNombre={`${usuario.nombre} ${usuario.apellido}`.trim()}
            asistenteHabilitado={puedeUsarAsistente({ rol, puede_usar_asistente: usuario.puede_usar_asistente })}
          />
```

- [ ] **Paso 4: Verificar tipos y build**

```bash
npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Paso 5: Probarlo a mano**

Pedile al usuario que se conceda el permiso (o hacelo por SQL desde el editor de
Supabase con `update usuarios set puede_usar_asistente = true where email = '…'`),
levante el dev server y pruebe tres preguntas:

1. Una de datos de un módulo que tenga: *"¿cuántos requerimientos están pendientes?"*
2. Una de datos de un módulo que **no** tenga: *"¿cuánto se liquidó en agosto?"* —
   tiene que contestar que no ve nada, no dar un número.
3. Una de procedimiento: *"¿cómo cargo un aviso de mantenimiento?"*

Anotá qué SQL corrió en cada una. Ese es el insumo de las vistas que el spec
dejó para después.

> **No corras `next build` con el dev server levantado**: deja la app en 500.

- [ ] **Paso 6: Commit**

```bash
git add components/Asistente.tsx components/Header.tsx "app/(app)/layout.tsx"
git commit -m "feat(asistente): el panel lateral, con el SQL a la vista"
```

---

## Fase 4 — El permiso en Administración

### Tarea 13: La casilla

**Archivos:**
- Modificar: `app/(app)/administracion/usuarios/page.tsx`
- Modificar: `app/(app)/administracion/usuarios/UsuariosClient.tsx`
- Modificar: `app/api/administracion/usuarios/[id]/route.ts`
- Modificar: `app/api/administracion/usuarios/route.ts`

- [ ] **Paso 1: Aceptar el campo en el PUT**

En `app/api/administracion/usuarios/[id]/route.ts`, después de la línea de
`activo`:

```ts
  if (body.activo !== undefined) data.activo = body.activo;
  // Permiso de gasto, no de datos: lo que ve el asistente sale de RLS igual que
  // en las pantallas. Ver `puedeUsarAsistente` en lib/core/access.ts.
  if (body.puede_usar_asistente !== undefined) {
    data.puede_usar_asistente = Boolean(body.puede_usar_asistente);
  }
```

Y agregá el campo al select del final de la función:

```ts
  const { data: usuario } = await admin.from("usuarios").select("id, email, nombre, apellido, rol, activo, puede_usar_asistente").eq("id", id).single();
```

- [ ] **Paso 2: Traerlo en el GET de la lista**

En `app/api/administracion/usuarios/route.ts`, en el `select` del GET:

```ts
    .select("id, email, nombre, apellido, rol, activo, puede_usar_asistente, usuario_modulos(id, modulo, nivel)")
```

- [ ] **Paso 3: Traerlo en la página**

En `app/(app)/administracion/usuarios/page.tsx`, en el select de `usuarios`
(**una sola cadena literal**):

```ts
      .select("id, email, nombre, apellido, rol, activo, puede_usar_asistente, usuario_modulos(id, modulo, nivel), usuario_areas_compras(area_id)")
```

- [ ] **Paso 4: Agregar la casilla**

En `UsuariosClient.tsx`, agregá el campo a la interfaz `Usuario`:

```ts
interface Usuario {
  id: string;
  email: string;
  nombre: string;
  apellido: string;
  rol: Rol;
  activo: boolean;
  puede_usar_asistente: boolean;
  usuario_modulos: UsuarioModulo[];
  usuario_areas_compras: AreaDelUsuario[];
}
```

En `EditarUsuarioModal`, agregá el campo al estado:

```ts
  const [form, setForm] = useState({
    nombre: usuario.nombre,
    apellido: usuario.apellido,
    rol: usuario.rol,
    activo: usuario.activo,
    puede_usar_asistente: usuario.puede_usar_asistente,
  });
```

Y la casilla, justo debajo de la de "Activo":

```tsx
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} />
            Activo
          </label>
          <label className="flex items-start gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.puede_usar_asistente}
              onChange={(e) => setForm({ ...form, puede_usar_asistente: e.target.checked })}
            />
            <span>
              Puede usar el asistente
              <span className="block text-xs text-gray-400">
                Sólo ve lo que ya puede ver. Se concede de a poco porque cada pregunta cuesta.
              </span>
            </span>
          </label>
```

- [ ] **Paso 5: Verificar tipos**

```bash
npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Paso 6: Probar a mano**

Con el dev server: entrá a Administración → Usuarios, editá un usuario, marcá la
casilla, guardá, recargá y verificá que quedó marcada. Después entrá con ese
usuario y comprobá que le aparece el botón del asistente en el Header.

- [ ] **Paso 7: Commit**

```bash
git add "app/(app)/administracion/usuarios/page.tsx" "app/(app)/administracion/usuarios/UsuariosClient.tsx" "app/api/administracion/usuarios/[id]/route.ts" app/api/administracion/usuarios/route.ts
git commit -m "feat(asistente): conceder el permiso desde Administracion"
```

---

## Fase 5 — Los formularios prellenados

> Estas tres tareas son independientes entre sí y del resto: el asistente ya
> sirve sin ellas. Si hay que cortar por tiempo, se corta acá.

### Tarea 14: El requerimiento se abre desde la URL

`NuevoRequerimientoModal` **ya acepta `inicial`** — la usa `RepuestosOTModal`.
Falta sólo que el listado lo abra leyendo la URL.

**Archivos:**
- Modificar: `app/(app)/compras/requerimientos/RequerimientosClient.tsx`

- [ ] **Paso 1: Leer la URL al montar**

En `RequerimientosClient.tsx`, junto al `useState` de `modalAbierto` (línea 71),
reemplazalo por:

```ts
  /**
   * `?nuevo=1` abre el alta, y los demás parámetros la precargan.
   *
   * Lo usa el asistente: no escribe en la base, arma la URL y el formulario de
   * siempre hace lo de siempre. Se lee una sola vez al montar —igual que los
   * filtros de más abajo— porque de ahí en más el estado lo maneja la pantalla.
   *
   * El área y quién paga NO se leen de la URL, a propósito: son decisiones de
   * quien pide. Ver el comentario de `ValoresIniciales`.
   */
  const [arranqueDelAlta] = useState(() => {
    const params = new URLSearchParams(
      typeof window === "undefined" ? "" : window.location.search
    );
    if (params.get("nuevo") !== "1") return null;
    return {
      descripcion: params.get("descripcion") ?? undefined,
      codigo: params.get("codigo") ?? undefined,
      cantidad: params.get("cantidad") ?? undefined,
      detalle: params.get("detalle") ?? undefined,
    };
  });
  const [modalAbierto, setModalAbierto] = useState(arranqueDelAlta !== null);
```

- [ ] **Paso 2: Pasarle los valores al modal**

Reemplazá el bloque del modal (alrededor de la línea 756):

```tsx
      {modalAbierto && (
        <NuevoRequerimientoModal
          areas={areas}
          empresas={empresas}
          ubicaciones={ubicaciones}
          inicial={arranqueDelAlta ?? undefined}
          onClose={() => setModalAbierto(false)}
          onSaved={() => { setModalAbierto(false); cargar(); }}
        />
      )}
```

- [ ] **Paso 3: Verificar tipos**

```bash
npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Paso 4: Probar a mano**

Con el dev server, abrí:

```
http://localhost:3000/compras/requerimientos?nuevo=1&descripcion=Filtro%20de%20aceite&cantidad=4
```

Esperado: se abre el modal con la descripción y la cantidad puestas, y **el área
vacía**.

- [ ] **Paso 5: Commit**

```bash
git add "app/(app)/compras/requerimientos/RequerimientosClient.tsx"
git commit -m "feat(compras): el alta de un RI se puede abrir precargada desde la URL"
```

---

### Tarea 15: El movimiento acepta la cantidad

`?articulo=` ya anda. Falta `?cantidad=`.

**Archivos:**
- Modificar: `app/(app)/inventario/movimientos/nuevo/page.tsx`
- Modificar: `app/(app)/inventario/movimientos/nuevo/NuevoMovimientoClient.tsx`

- [ ] **Paso 1: Leer el parámetro en la página**

En `page.tsx`, junto a `articuloId`:

```ts
  const params = await searchParams;
  const articuloId = typeof params.articulo === "string" ? params.articulo : null;
  // La cantidad la puede precargar quien manda a esta pantalla (hoy, el
  // asistente). Se pasa como texto: la valida el formulario, igual que si la
  // hubieran tipeado.
  const cantidadInicial = typeof params.cantidad === "string" ? params.cantidad : "";
```

Y pasásela al cliente:

```tsx
    <NuevoMovimientoClient
      sync={sync}
      articuloInicial={articulo}
      cantidadInicial={cantidadInicial}
```

- [ ] **Paso 2: Recibirla en el cliente**

En `NuevoMovimientoClient.tsx`:

```tsx
export default function NuevoMovimientoClient({
  articuloInicial, cantidadInicial, destinos, solicitantes, equipos, proveedores, sync,
}: {
  articuloInicial: Articulo | null;
  /** Precargada desde la URL. Se puede editar antes de guardar. */
  cantidadInicial: string;
  destinos: Opcion[];
  solicitantes: Solicitante[];
  equipos: Equipo[];
  proveedores: Opcion[];
  sync: UltimaSync | null;
}) {
```

Y cambiá el estado de `cantidad`:

```ts
  const [cantidad, setCantidad] = useState(cantidadInicial);
```

- [ ] **Paso 3: Verificar tipos**

```bash
npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Paso 4: Probar a mano**

Con un id de artículo real (sacalo del stock), abrí:

```
http://localhost:3000/inventario/movimientos/nuevo?articulo=<id>&cantidad=3
```

Esperado: el artículo elegido y la cantidad en 3.

- [ ] **Paso 5: Commit**

```bash
git add "app/(app)/inventario/movimientos/nuevo/page.tsx" "app/(app)/inventario/movimientos/nuevo/NuevoMovimientoClient.tsx"
git commit -m "feat(inventario): el movimiento nuevo acepta la cantidad por URL"
```

---

### Tarea 16: El aviso se abre precargado

Éste es el único que necesita la prop nueva.

**Archivos:**
- Modificar: `app/(app)/mantenimiento/avisos/NuevoAvisoModal.tsx`
- Modificar: `app/(app)/mantenimiento/avisos/AvisosClient.tsx`

- [ ] **Paso 1: Agregarle `inicial` al modal**

En `NuevoAvisoModal.tsx`, arriba de la función:

```tsx
/**
 * Con qué campos abre el formulario.
 *
 * Mismo criterio que `ValoresIniciales` del RI: lo que ya está escrito de otro
 * lado no se vuelve a tipear. Lo usa el asistente, que arma la URL y no escribe
 * en la base.
 *
 * El sector no va acá: sale solo al elegir el equipo, porque la máquina sabe
 * dónde está.
 */
export interface ValoresInicialesAviso {
  equipo?: string;
  descripcion?: string;
  urgencia?: string;
}
```

Cambiá la firma:

```tsx
export default function NuevoAvisoModal({
  inicial, onCerrar, onCreado,
}: {
  /** Precargado desde la URL. Se puede editar todo antes de enviar. */
  inicial?: ValoresInicialesAviso;
  onCerrar: () => void;
  onCreado: (oaNumber: string) => void;
}) {
```

Y sembrá el estado:

```tsx
  const [campos, setCampos] = useState({
    equipo_raw: inicial?.equipo ?? "",
    sector_raw: "",
    sector_id: "",
    descripcion: inicial?.descripcion ?? "",
    urgencia: inicial?.urgencia ?? (URGENCIAS[1] as string),
    quien_aviso: "",
    observaciones: "",
  });
```

- [ ] **Paso 2: Leer la URL en el listado**

En `AvisosClient.tsx`, reemplazá el `useState` de `creando` (línea 34):

```ts
  /**
   * `?nuevo=1` abre el alta con los campos que vengan en la URL. Lo usa el
   * asistente: arma la intención, y la pantalla hace lo de siempre.
   */
  const [arranqueDelAlta] = useState(() => {
    const params = new URLSearchParams(
      typeof window === "undefined" ? "" : window.location.search
    );
    if (params.get("nuevo") !== "1") return null;
    return {
      equipo: params.get("equipo") ?? undefined,
      descripcion: params.get("descripcion") ?? undefined,
      urgencia: params.get("urgencia") ?? undefined,
    };
  });
  const [creando, setCreando] = useState(arranqueDelAlta !== null);
```

- [ ] **Paso 3: Pasarle los valores**

En el bloque del modal (alrededor de la línea 311), agregá la prop:

```tsx
        <NuevoAvisoModal
          inicial={arranqueDelAlta ?? undefined}
```

(dejá las props `onCerrar` y `onCreado` como están).

- [ ] **Paso 4: Verificar tipos**

```bash
npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Paso 5: Probar a mano**

```
http://localhost:3000/mantenimiento/avisos?nuevo=1&descripcion=Pierde%20aceite
```

Esperado: el modal abierto con la descripción puesta.

- [ ] **Paso 6: Commit**

```bash
git add "app/(app)/mantenimiento/avisos/NuevoAvisoModal.tsx" "app/(app)/mantenimiento/avisos/AvisosClient.tsx"
git commit -m "feat(mantenimiento): el aviso se puede abrir precargado desde la URL"
```

---

## Fase 6 — Documentación y cierre

### Tarea 17: El documento del asistente

**Archivos:**
- Crear: `docs/ASISTENTE.md`
- Modificar: `CLAUDE.md`

- [ ] **Paso 1: Escribir `docs/ASISTENTE.md`**

Tiene que contestar, para alguien que lo retoma en seis meses:

1. **Qué es y qué no es.** Lee y prepara; nunca escribe. Crea altas pendientes;
   nunca cambia estados.
2. **Cómo se respetan los permisos**, con las tres capas y cuál es la que
   sostiene. Incluí que Compras es lectura abierta desde la 018 y que el
   asistente lo hereda a propósito.
3. **Cómo se regenera el catálogo** (`npm run catalogo`) y que hay que hacerlo
   cuando cambia el esquema. Que el reporte de tablas sin mapear no es un
   adorno: una tabla sin mapear es invisible para el asistente.
4. **Dónde tocar cuando una respuesta sale mal**: casi siempre es una nota que
   falta en `lib/asistente/notas.ts`, no el prompt.
5. **El riesgo asumido**, textual: con SQL generado, a veces va a dar un número
   que parece bien y está mal. Por eso la respuesta muestra siempre la consulta.
6. **Qué mirar en `asistente_consultas`** para decidir las vistas de consulta
   que el spec dejó para después: agrupá por si hubo error y por qué tablas
   aparecen más.
7. **El tope diario** (`TOPE_DIARIO` en la ruta) y cómo se cambia.

- [ ] **Paso 2: Sumarlo al índice de CLAUDE.md**

En la tabla "Antes de retomar un módulo, leer su documento", agregá una fila:

```markdown
| Asistente | [docs/ASISTENTE.md](docs/ASISTENTE.md) · [spec](docs/superpowers/specs/2026-09-16-asistente-design.md) |
```

- [ ] **Paso 3: Commit**

```bash
git add docs/ASISTENTE.md CLAUDE.md
git commit -m "docs(asistente): como se retoma, donde se toca y que riesgo queda asumido"
```

---

### Tarea 18: Verificación final

- [ ] **Paso 1: La suite entera**

```bash
npm test
```

Esperado: todo verde. Si algo falla en archivos que no tocaste, **mirá
`git status` antes de arreglarlo**: puede ser un refactor en curso de otra
sesión, y arreglarlo es pisarlo.

- [ ] **Paso 2: Tipos**

```bash
npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Paso 3: Build**

**Parar el dev server antes** — `next build` con `npm run dev` levantado deja la
app en 500.

```bash
npm run build
```

Esperado: build exitoso.

- [ ] **Paso 4: El árbol commiteado**

Éste es el que atrapa lo que los otros tres no pueden: Vercel construye el árbol
de git, no el disco, y acá se commitea con rutas explícitas.

```bash
node scripts/revisar-arbol-commiteado.mjs
```

Esperado: sin imports sin resolver. Si reporta alguno de `lib/asistente/`, es un
archivo que quedó *staged* y nunca se commiteó: commitealo por nombre.

> Ojo con `lib/asistente/catalogo.generado.json`: es generado, pero **tiene que
> estar commiteado**, porque `catalogo.ts` lo importa y el build de Vercel no lo
> genera.

- [ ] **Paso 5: Pushear**

```bash
git push
```

Si otra sesión movió `main` mientras tanto, no hagas `git add -A` ni un rebase
que arrastre commits ajenos: rebaseá lo tuyo o armá el árbol con plumbing sobre
`origin/main`.

- [ ] **Paso 6: Contarle al usuario qué quedó**

Decile explícitamente:

- Que las dos migraciones ya corrieron y qué agregaron.
- Que el permiso arranca en `false` para todos, y cómo se concede.
- Cuánto quedó el tope diario y dónde se cambia.
- **Las tres preguntas de prueba y qué SQL corrió cada una.** Es lo que le
  permite juzgar si los números están bien.
- Que las vistas de consulta quedaron para cuando la bitácora diga cuáles.
