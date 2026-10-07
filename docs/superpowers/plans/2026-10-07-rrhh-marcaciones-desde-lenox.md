# Marcaciones desde Lenox — Plan de implementación

> **Para quien ejecute esto:** SUB-SKILL REQUERIDA: usar
> `superpowers:subagent-driven-development` (recomendado) o
> `superpowers:executing-plans` para ir tarea por tarea. Los pasos usan
> casillas (`- [ ]`) para ir marcando.

**Objetivo:** que las marcaciones del reloj lleguen solas desde la API de Lenox
—con un cron diario y un botón— en vez de por un `.xlsx` que alguien baja y
sube a mano.

**Arquitectura:** un cliente HTTP tonto (`lib/rrhh/lenox/cliente.ts`) que
resuelve el tope de 7 días y la paginación; un agrupador puro
(`lib/rrhh/lenox/agrupar.ts`) que convierte marcaciones sueltas en días con
tokens; y el alta de fichadas extraída de la ruta de import a
`lib/rrhh/fichadas/`, partida en una capa pura que **decide** y una capa que
**escribe**, compartida por los dos caminos de carga. `reconciliarMarcaciones`
no se reescribe: se parte para que acepte tokens y su firma actual queda como
envoltorio.

**Stack:** Next.js 16 (App Router), Supabase, vitest, zod. Sin dependencias
nuevas — `fetch` nativo.

**Spec:** [2026-10-07-rrhh-marcaciones-desde-lenox-design.md](../specs/2026-10-07-rrhh-marcaciones-desde-lenox-design.md)

---

## Mapa de archivos

| Archivo | Responsabilidad |
|---|---|
| `lib/rrhh/lenox/tipos.ts` | **Crear.** Las formas que devuelve la API, y nada más |
| `lib/rrhh/lenox/cliente.ts` | **Crear.** HTTP: clave, ventanas de ≤7 días, paginación, errores |
| `lib/rrhh/lenox/cliente.test.ts` | **Crear.** `ventanasDe` + paginación con `fetch` mockeado |
| `lib/rrhh/lenox/agrupar.ts` | **Crear.** Marcaciones sueltas → días con tokens, por legajo |
| `lib/rrhh/lenox/agrupar.test.ts` | **Crear.** Días vacíos, orden, legajo desconocido |
| `lib/rrhh/lenox/sincronizar.ts` | **Crear.** Orquesta: trae → agrupa → aplica → coteja |
| `lib/rrhh/fichadas/decidir.ts` | **Crear.** Puro: qué insertar, qué borrar, qué saltear, qué avisar |
| `lib/rrhh/fichadas/decidir.test.ts` | **Crear.** Las tres protecciones y el dedup |
| `lib/rrhh/fichadas/aplicar.ts` | **Crear.** IO: lee el contexto, llama a `decidir`, escribe, recalcula |
| `lib/rrhh/excelImport.ts` | **Modificar.** Partir `reconciliarMarcaciones` en núcleo + envoltorio |
| `app/api/rrhh/fichadas/import/confirm/route.ts` | **Modificar.** Pasa a usar `aplicar.ts` |
| `app/api/rrhh/fichadas/route.ts` | **Modificar.** El `POST` marca el día como corregido |
| `app/api/rrhh/fichadas/[id]/route.ts` | **Modificar.** El `PUT` y el `DELETE` marcan el día |
| `app/api/rrhh/fichadas/lenox/sincronizar/route.ts` | **Crear.** El botón |
| `app/api/cron/rrhh-lenox-sync/route.ts` | **Crear.** El cron diario |
| `app/(app)/rrhh/fichadas/FichadasClient.tsx` | **Modificar.** Botón, cartel y plegado del Excel |
| `app/(app)/rrhh/fichadas/page.tsx` | **Modificar.** Pasar la última sincronización |
| `vercel.json` | **Modificar.** El cron nuevo |
| `supabase/migrations/<ts>_rrhh_dias_corregidos.sql` | **Crear.** La tabla + RLS |
| `supabase/migrations/<ts>_rrhh_import_batches_sin_usuario.sql` | **Crear.** `usuario_id` nullable |

---

## Tarea 1: Medir la API real antes de escribir el cliente

El spec lista cinco incógnitas. Son el motivo de esta tarea: Despacho se diseñó
con dos supuestos sobre su libro y los dos eran falsos. **No escribas el cliente
antes de terminar esta tarea** — los números que salgan de acá cambian el
código de la Tarea 4.

**Archivos:**
- Crear (temporal, en el scratchpad, **no** en el repo): `medir-lenox.mjs`
- Modificar: `docs/superpowers/specs/2026-10-07-rrhh-marcaciones-desde-lenox-design.md`

- [ ] **Paso 1: Verificar que la clave está en el entorno**

```bash
grep -c '^LENOX_API_KEY=' .env.local
```

Esperado: `1`. Si dice `0`, parar y pedirla — todo lo demás de esta tarea
depende de ella. **No la escribas en ningún archivo del repo ni en un mensaje.**

- [ ] **Paso 2: Escribir el script de medición en el scratchpad**

Guardalo fuera del repo. En este entorno, el directorio de scratchpad de la
sesión; en otro, `/tmp`. El archivo es `medir-lenox.mjs`:

```js
const CLAVE = process.env.LENOX_API_KEY;
const BASE = "https://empresas.api.lenoxhr.com/api/v1";

async function pedir(ruta, params = {}) {
  const url = new URL(BASE + ruta);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const t0 = Date.now();
  const res = await fetch(url, { headers: { "LenoxBusinessAPI-Key": CLAVE } });
  const texto = await res.text();
  let cuerpo;
  try { cuerpo = JSON.parse(texto); } catch { cuerpo = texto.slice(0, 300); }
  return { status: res.status, ms: Date.now() - t0, cuerpo };
}

// 1 y 2 — ¿devuelve a todos sin filtrar por legajo? ¿cuántas filas trae?
const r1 = await pedir("/marcaciones/getmarcaciones", {
  Desde: "2026-09-22", Hasta: "2026-09-28", ExcluirDadosDeBaja: true,
});
console.log("status", r1.status, "en", r1.ms, "ms");
console.log("mensaje:", r1.cuerpo?.mensaje);
const filas = r1.cuerpo?.resultado ?? [];
console.log("filas:", filas.length);
console.log("legajos distintos:", new Set(filas.map((f) => f.legajo)).size);

// 3 y 4 — qué trae tipoMarcacion, y qué forma tiene el legajo
console.log("tipoMarcacion:", [...new Set(filas.map((f) => f.tipoMarcacion))]);
console.log("relojes:", [...new Set(filas.map((f) => f.reloj))].slice(0, 5));
console.log("muestra de legajos:", [...new Set(filas.map((f) => f.legajo))].slice(0, 8));
console.log("primera fila completa:", JSON.stringify(filas[0], null, 1));

// 1 (cont.) — ¿FilasExcluidas es realmente un offset?
const r2 = await pedir("/marcaciones/getmarcaciones", {
  Desde: "2026-09-22", Hasta: "2026-09-28", ExcluirDadosDeBaja: true, FilasExcluidas: 10,
});
const filas2 = r2.cuerpo?.resultado ?? [];
console.log("con FilasExcluidas=10 →", filas2.length, "filas; mensaje:", r2.cuerpo?.mensaje);
console.log("¿la fila 11 de la primera tanda es la 1 de la segunda?",
  JSON.stringify(filas[10]) === JSON.stringify(filas2[0]));

// Empleados, para la Tarea 10
const r3 = await pedir("/empleados/getempleados", { ExcluirBajas: false });
const emps = r3.cuerpo?.resultado ?? [];
console.log("empleados:", emps.length, "| con fechaBaja:", emps.filter((e) => e.fechaBaja).length);
console.log("muestra:", JSON.stringify(emps[0], null, 1));

// 5 — ¿hay límite de llamadas? Diez seguidas y se mira si alguna cambia de status.
const codigos = [];
for (let i = 0; i < 10; i++) {
  const r = await pedir("/marcaciones/getmarcaciones", { FechaJornada: "2026-09-25" });
  codigos.push(r.status);
}
console.log("diez llamadas seguidas:", codigos.join(" "));
```

- [ ] **Paso 3: Correrlo**

```bash
node --env-file=.env.local "$TEMP/medir-lenox.mjs"
```

Esperado: un `status 200` y una lista de números. Si sale 401, la clave está
mal o la API no quedó activada: parar y avisar, no seguir adivinando.

- [ ] **Paso 4: Cotejar los legajos contra la base**

```bash
node --env-file=.env.local -e "
const {createClient}=require('@supabase/supabase-js');
const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
(async()=>{
  const res=await fetch('https://empresas.api.lenoxhr.com/api/v1/empleados/getempleados?ExcluirBajas=true',
    {headers:{'LenoxBusinessAPI-Key':process.env.LENOX_API_KEY}});
  const {resultado}=await res.json();
  const enLenox=new Set((resultado||[]).map(e=>String(e.legajo).trim()));
  const {data}=await s.from('empleados').select('legajo,activo');
  const enSdG=new Set(data.map(e=>String(e.legajo).trim()));
  console.log('Lenox:',enLenox.size,'| SdG:',enSdG.size);
  console.log('en Lenox y no en el SdG:',[...enLenox].filter(l=>!enSdG.has(l)));
  console.log('en el SdG y no en Lenox:',[...enSdG].filter(l=>!enLenox.has(l)));
})();
"
```

Esperado: las dos listas de diferencia **vacías o cortas**. Si el formato no
coincide —por ejemplo si Lenox devuelve `204` donde el SdG tiene `PC_204`—
**parar acá**: el mapeo por legajo deja de ser directo y el spec hay que
revisarlo antes de escribir una línea más.

- [ ] **Paso 5: Escribir lo medido en el spec**

En el spec, reemplazar la sección **"Lo que falta medir, el día que llegue la
clave"** por **"Lo que se midió contra la API real (fecha)"**, con una tabla de
las cinco respuestas y los números reales. El resto del spec no se toca.

- [ ] **Paso 6: Commit**

```bash
git add docs/superpowers/specs/2026-10-07-rrhh-marcaciones-desde-lenox-design.md
git commit -m "docs(rrhh): las cinco incógnitas de la API de Lenox, medidas

Antes de escribir el cliente, contra la API real: tope de filas por
respuesta, si GetMarcaciones sin Legajo devuelve a todos, qué trae
tipoMarcacion, que el legajo sea el string y no un id interno, y si hay
límite de llamadas.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Tarea 2: Las dos migraciones (y quedar a la espera)

Van temprano porque **las corre una persona a mano en el editor SQL de
Supabase** y bloquean las tareas 7, 8 y 9. Mientras tanto se puede seguir con
las tareas 3 a 6, que son puras.

**Archivos:**
- Crear: `supabase/migrations/<ts>_rrhh_dias_corregidos.sql`
- Crear: `supabase/migrations/<ts>_rrhh_import_batches_sin_usuario.sql`

- [ ] **Paso 1: Leer las ocho trampas**

```bash
cat supabase/migrations/README.md
```

Ninguna de estas dos toca un enum ni un índice parcial, pero leelas igual: es
donde está escrito por qué una migración aplicada no se edita.

- [ ] **Paso 2: Crear el primer archivo**

```bash
npm run migracion "rrhh dias corregidos"
```

Escribir adentro:

```sql
-- ============================================================
-- SdG — Los días que tocó una persona
--
-- Spec: docs/superpowers/specs/2026-10-07-rrhh-marcaciones-desde-lenox-design.md
--
-- POR QUÉ: las marcaciones pasan a entrar solas desde la API de Lenox, con un
-- cron diario. Eso convierte en peligroso algo que hoy es inofensivo: editar
-- una fichada NO cambia su `origen`, y el import borra todas las IMPORTADO del
-- día antes de insertar. Hoy casi no muerde porque quien sube el Excel sabe
-- que está pisando un período; un cron pisa sin que nadie se entere.
--
-- POR QUÉ POR DÍA Y NO POR FICHADA. La primera idea fue un tercer valor
-- CORREGIDO en `origen_fichada`. No alcanza, por dos razones:
--   1. La sincronización no reemplaza fichadas, reemplaza DÍAS. Proteger la
--      fila corregida y reinsertar el día deja las dos: el día duplicado.
--   2. Borrar no deja rastro. Una marca fantasma a 40 minutos de la anterior
--      (el filtro sólo descarta las de ≤5 min) arma un turno falso; alguien lo
--      borra; mañana el cron lo vuelve a crear. Todos los días, para siempre.
--      Con el enum no se arregla: la fila que lo probaría ya no existe.
-- ============================================================

create table if not exists rrhh_dias_corregidos (
  id          uuid primary key default gen_random_uuid(),
  empleado_id uuid not null references empleados(id) on delete cascade,
  fecha       date not null,
  -- Quién lo tocó. No es decorativo: cuando alguien pregunte "¿por qué este
  -- día no se actualiza?", la respuesta tiene que estar escrita.
  usuario_id  uuid not null references usuarios(id),
  accion      text not null check (accion in ('creada', 'editada', 'borrada')),
  created_at  timestamptz not null default now(),
  unique (empleado_id, fecha)
);

-- La sincronización pregunta por rango de fechas y por empleado.
create index if not exists rrhh_dias_corregidos_fecha_idx
  on rrhh_dias_corregidos (fecha, empleado_id);

alter table rrhh_dias_corregidos enable row level security;

-- `create policy` no acepta `if not exists`, y el README exige que una
-- migración aguante correrse dos veces: sin el drop, la segunda corrida falla
-- con 42710 y el editor de Supabase revierte el script entero.
drop policy if exists rrhh_dias_corregidos_select on rrhh_dias_corregidos;
create policy rrhh_dias_corregidos_select on rrhh_dias_corregidos
  for select to authenticated using (tiene_acceso_rrhh());

drop policy if exists rrhh_dias_corregidos_write on rrhh_dias_corregidos;
create policy rrhh_dias_corregidos_write on rrhh_dias_corregidos
  for all to authenticated using (puede_editar_rrhh()) with check (puede_editar_rrhh());

comment on table rrhh_dias_corregidos is
  'Los (empleado, día) que tocó una persona a mano. La sincronización con '
  'Lenox los saltea y avisa si lo que trae el reloj difiere de lo guardado.';
```

- [ ] **Paso 3: Crear el segundo archivo**

```bash
npm run migracion "rrhh import batches sin usuario"
```

Escribir adentro:

```sql
-- ============================================================
-- SdG — Un lote de importación puede no tener usuario
--
-- Spec: docs/superpowers/specs/2026-10-07-rrhh-marcaciones-desde-lenox-design.md
--
-- POR QUÉ: `rrhh_import_batches` se reusa para anotar lo que trae la
-- sincronización con Lenox —ya tiene cantidad_registros, cantidad_errores y
-- log_detalle, y es donde la gente ya busca los avisos—. El cron no tiene
-- usuario, y `usuario_id` era not null.
--
-- El `nombre_archivo` de esos lotes dice "Lenox API · 30/09 → 06/10". Se
-- mantiene el nombre de la columna aunque ya no sea siempre un archivo:
-- renombrarla rompería las lecturas existentes para ganar prolijidad.
-- ============================================================

alter table rrhh_import_batches alter column usuario_id drop not null;

comment on column rrhh_import_batches.usuario_id is
  'Quién subió el archivo. NULL cuando el lote lo creó el cron de Lenox.';
```

- [ ] **Paso 4: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(rrhh): la tabla de días corregidos y el batch sin usuario

Las dos migraciones que necesita la sincronización con Lenox. Quedan a la
espera de que las corra una persona en el editor SQL.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Paso 5: Pedirlas y quedar a la espera**

Decirle al usuario, con los dos nombres de archivo, que las corra en el editor
SQL de Supabase. **No seguir a las tareas 7, 8 ni 9 hasta que confirme.** Las
tareas 3 a 6 no dependen de esto.

- [ ] **Paso 6: Verificar que corrieron, cuando avise**

```bash
node --env-file=.env.local -e "
const {createClient}=require('@supabase/supabase-js');
const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
(async()=>{
  const a=await s.from('rrhh_dias_corregidos').select('id').limit(1);
  console.log('rrhh_dias_corregidos:', a.error ? 'FALTA — '+a.error.message : 'ok');
  const b=await s.from('rrhh_import_batches').insert({nombre_archivo:'prueba',usuario_id:null}).select('id').single();
  console.log('usuario_id nullable:', b.error ? 'FALTA — '+b.error.message : 'ok');
  if(b.data) await s.from('rrhh_import_batches').delete().eq('id',b.data.id);
})();
"
```

Esperado: `rrhh_dias_corregidos: ok` y `usuario_id nullable: ok`.

---

## Tarea 3: `reconciliarMarcaciones` acepta tokens

El refactor que permite que el camino de Lenox entre sin armar strings
sintéticos. **Los tests existentes no se tocan** — entran por el envoltorio.

**Archivos:**
- Modificar: `lib/rrhh/excelImport.ts`
- Test: `lib/rrhh/reconciliarMarcaciones.test.ts` (sólo se le **agrega** un caso)

- [ ] **Paso 1: Escribir el test que falla**

Agregar al final de `lib/rrhh/reconciliarMarcaciones.test.ts`:

```ts
import { reconciliarTokens, tokenizeMarcaciones } from "./excelImport";

describe("reconciliarTokens", () => {
  it("da exactamente lo mismo que el envoltorio que tokeniza", () => {
    const crudos = [
      { fecha: dia(2026, 6, 1), raw: " E 19:40" },
      { fecha: dia(2026, 6, 2), raw: " E 03:40 - S 19:37" },
    ];
    const porRaw = reconciliarMarcaciones(crudos);
    const porTokens = reconciliarTokens(
      crudos.map((d) => ({ fecha: d.fecha, tokens: tokenizeMarcaciones(d.raw) }))
    );
    expect(porTokens).toEqual(porRaw);
  });

  it("filtra las marcaciones fantasma también cuando entra por tokens", () => {
    const { turnos } = reconciliarTokens([
      {
        fecha: dia(2026, 6, 1),
        tokens: [
          { tipo: "E", hora: "08:00" },
          { tipo: "E", hora: "08:03" }, // fantasma: ≤5 min de la anterior
          { tipo: "S", hora: "16:00" },
        ],
      },
    ]);
    expect(turnos).toEqual([
      { fecha: dia(2026, 6, 1), entradaStr: "08:00", salidaStr: "16:00", fechaSalida: dia(2026, 6, 1) },
    ]);
  });
});
```

- [ ] **Paso 2: Correrlo y ver que falla**

```bash
npx vitest run lib/rrhh/reconciliarMarcaciones.test.ts
```

Esperado: FALLA con `"reconciliarTokens" is not exported by "lib/rrhh/excelImport.ts"`.

- [ ] **Paso 3: Partir la función**

En `lib/rrhh/excelImport.ts`, **al lado de** `DiaMarcacionesCrudo`, agregar:

```ts
export interface DiaMarcacionesTokens {
  fecha: Date; // día calendario (UTC-medianoche), ordenados ascendente por el llamador
  tokens: TokenMarcacion[]; // crudos: el filtro de fantasmas se aplica acá adentro
}
```

Renombrar la función actual `reconciliarMarcaciones` a `reconciliarTokens`,
cambiar su firma a `dias: DiaMarcacionesTokens[]`, y reemplazar adentro la
línea que tokeniza:

```ts
// antes:
let tokens = filtrarMarcacionesFantasma(tokenizeMarcaciones(dia.raw));
// después:
let tokens = filtrarMarcacionesFantasma(dia.tokens);
```

Y agregar el envoltorio, con el bloque de comentario original encima:

```ts
/**
 * La forma histórica: recibe la celda cruda "Marcaciones" de cada día y la
 * tokeniza. Es por donde entra el import de Excel, y la que cubren los tests
 * de `reconciliarMarcaciones.test.ts`. El camino de Lenox entra por
 * `reconciliarTokens`, porque la API devuelve las marcaciones sueltas y armar
 * un string para volver a parsearlo sería una ida y vuelta sin motivo.
 */
export function reconciliarMarcaciones(
  dias: DiaMarcacionesCrudo[],
  abiertoPrevio?: { fecha: Date; entradaStr: string } | null
): { turnos: TurnoResuelto[]; avisos: AvisoReconciliacion[] } {
  return reconciliarTokens(
    dias.map((d) => ({ fecha: d.fecha, tokens: tokenizeMarcaciones(d.raw) })),
    abiertoPrevio
  );
}
```

- [ ] **Paso 4: Correr toda la suite**

```bash
npx vitest run lib/rrhh/
```

Esperado: PASA todo, incluidos los tests viejos de `reconciliarMarcaciones`
sin haberlos tocado. Si alguno de los viejos falla, el refactor cambió
comportamiento: volver atrás y revisar, no ajustar el test.

- [ ] **Paso 5: Commit**

```bash
git add lib/rrhh/excelImport.ts lib/rrhh/reconciliarMarcaciones.test.ts
git commit -m "refactor(rrhh): reconciliarMarcaciones acepta tokens, no sólo la celda cruda

La API de Lenox devuelve las marcaciones sueltas, no la celda
\"E 08:07 - S 15:56\" que arma el Excel. El núcleo pasa a tomar tokens y la
firma de siempre queda como envoltorio que tokeniza y delega, así los tests
existentes siguen entrando por donde entraban y no se tocó ninguno.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Tarea 4: El cliente HTTP

**Usa los números de la Tarea 1.** Si la medición dijo que hay que iterar por
legajo, o que el tope de filas es otro, ajustá el código de abajo antes de
escribirlo.

**Archivos:**
- Crear: `lib/rrhh/lenox/tipos.ts`
- Crear: `lib/rrhh/lenox/cliente.ts`
- Test: `lib/rrhh/lenox/cliente.test.ts`

- [ ] **Paso 1: Escribir los tipos**

`lib/rrhh/lenox/tipos.ts`:

```ts
/**
 * Las formas que devuelve la API de Lenox, tal como vienen. No se adaptan ni
 * se renombran acá a propósito: cuando algo no cierre, lo que se compara
 * contra la doc tiene que ser esto y no una traducción nuestra.
 *
 * Doc: https://postman.lenoxhr.com/
 */

export interface MarcacionLenox {
  nombre: string;
  apellido: string;
  legajo: string;
  marcacion: string; // "2026-10-23 07:00:00"
  marcacionFecha: string; // "2026-10-23"
  marcacionHora: string; // "07:00:00"
  tipoMarcacion: string | null;
  comentario: string | null;
  reloj: string | null;
}

export interface EmpleadoLenox {
  nombre: string;
  apellido: string;
  legajo: string;
  sector: string | null;
  sucursal: string | null;
  fechaIngreso: string | null;
  fechaBaja: string | null; // no null ⇒ dado de baja en Lenox
}
```

- [ ] **Paso 2: Escribir el test que falla**

`lib/rrhh/lenox/cliente.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { ventanasDe, traerMarcaciones, DIAS_MAX_POR_PEDIDO } from "./cliente";
import { toUtcDateOnly } from "../dates";

function dia(y: number, m: number, d: number) {
  return toUtcDateOnly(y, m - 1, d);
}
function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

describe("ventanasDe", () => {
  it("un rango que entra en el tope es una sola ventana", () => {
    const v = ventanasDe(dia(2026, 10, 1), dia(2026, 10, 7));
    expect(v.map((x) => [iso(x.desde), iso(x.hasta)])).toEqual([["2026-10-01", "2026-10-07"]]);
  });

  it("un mes se parte en ventanas de 7 días, sin huecos ni solapes", () => {
    const v = ventanasDe(dia(2026, 10, 1), dia(2026, 10, 31));
    expect(v).toHaveLength(5);
    expect(iso(v[0].desde)).toBe("2026-10-01");
    expect(iso(v[0].hasta)).toBe("2026-10-07");
    expect(iso(v[1].desde)).toBe("2026-10-08");
    expect(iso(v[4].hasta)).toBe("2026-10-31");
    for (let i = 1; i < v.length; i++) {
      const finAnterior = v[i - 1].hasta.getTime();
      const inicio = v[i].desde.getTime();
      expect(inicio - finAnterior).toBe(86_400_000); // exactamente un día
    }
  });

  it("ninguna ventana supera el tope que impone la API", () => {
    for (const x of ventanasDe(dia(2026, 1, 1), dia(2026, 3, 15))) {
      const dias = (x.hasta.getTime() - x.desde.getTime()) / 86_400_000 + 1;
      expect(dias).toBeLessThanOrEqual(DIAS_MAX_POR_PEDIDO);
    }
  });

  it("un solo día es una ventana de un día", () => {
    const v = ventanasDe(dia(2026, 10, 5), dia(2026, 10, 5));
    expect(v.map((x) => [iso(x.desde), iso(x.hasta)])).toEqual([["2026-10-05", "2026-10-05"]]);
  });
});

describe("traerMarcaciones", () => {
  afterEach(() => vi.unstubAllGlobals());

  function filaFalsa(n: number): Record<string, unknown> {
    return {
      nombre: "A", apellido: "B", legajo: "PC_001",
      marcacion: `2026-10-01 0${n}:00:00`, marcacionFecha: "2026-10-01",
      marcacionHora: `0${n}:00:00`, tipoMarcacion: null, comentario: null, reloj: null,
    };
  }

  it("pagina hasta que una página vuelve vacía", async () => {
    vi.stubEnv("LENOX_API_KEY", "clave-de-prueba");
    const paginas = [[filaFalsa(1), filaFalsa(2)], [filaFalsa(3)], []];
    let llamadas = 0;
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ mensaje: "ok", resultado: paginas[llamadas++] ?? [] }),
    })));

    const filas = await traerMarcaciones(dia(2026, 10, 1), dia(2026, 10, 1));
    expect(filas).toHaveLength(3);
    expect(llamadas).toBe(3);
  });

  it("manda la clave en el header y el offset en FilasExcluidas", async () => {
    vi.stubEnv("LENOX_API_KEY", "clave-de-prueba");
    const urls: string[] = [];
    const headers: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
      urls.push(url.toString());
      headers.push((init.headers as Record<string, string>)["LenoxBusinessAPI-Key"]);
      return { ok: true, status: 200, json: async () => ({ resultado: urls.length === 1 ? [filaFalsa(1)] : [] }) };
    }));

    await traerMarcaciones(dia(2026, 10, 1), dia(2026, 10, 1));
    expect(headers[0]).toBe("clave-de-prueba");
    expect(urls[0]).toContain("Desde=2026-10-01");
    expect(urls[0]).toContain("Hasta=2026-10-01");
    expect(urls[0]).toContain("FilasExcluidas=0");
    expect(urls[1]).toContain("FilasExcluidas=1");
  });

  it("un error de la API se propaga con lo que dijo Lenox, sin traducir", async () => {
    vi.stubEnv("LENOX_API_KEY", "clave-de-prueba");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false, status: 401, text: async () => "API Key inválida o inactiva",
    })));

    await expect(traerMarcaciones(dia(2026, 10, 1), dia(2026, 10, 1)))
      .rejects.toThrow("Lenox respondió 401: API Key inválida o inactiva");
  });
});
```

- [ ] **Paso 3: Correrlo y ver que falla**

```bash
npx vitest run lib/rrhh/lenox/cliente.test.ts
```

Esperado: FALLA — el módulo `./cliente` no existe.

- [ ] **Paso 4: Escribir el cliente**

`lib/rrhh/lenox/cliente.ts`:

```ts
import { addUtcDays } from "../dates";
import type { MarcacionLenox, EmpleadoLenox } from "./tipos";

const BASE = "https://empresas.api.lenoxhr.com/api/v1";

/**
 * El tope es de la API, no nuestro: "la diferencia entre las fechas desde y
 * hasta no puede superar los 7 días". Si se rompe, se rompe en silencio —
 * por eso hay un test que lo fija.
 */
export const DIAS_MAX_POR_PEDIDO = 7;

/**
 * Cuánto se pide por página. La doc no dice cuál es el tope de filas por
 * respuesta; lo único que hay es `FilasExcluidas`, que es un offset, y un
 * campo `mensaje` que a veces dice "Se muestran todos los resultados". Así
 * que no se confía en ningún número: se pagina siempre y se corta cuando una
 * página vuelve vacía. Es la misma precaución que con el corte mudo de
 * PostgREST en 1000 filas.
 */
const LOTE_ESPERADO = 1000;

export function hayCredencialesLenox(): boolean {
  return Boolean(process.env.LENOX_API_KEY?.trim());
}

/** Parte un rango en ventanas de a lo sumo `DIAS_MAX_POR_PEDIDO` días, sin huecos ni solapes. */
export function ventanasDe(desde: Date, hasta: Date): { desde: Date; hasta: Date }[] {
  const ventanas: { desde: Date; hasta: Date }[] = [];
  let inicio = desde;
  while (inicio.getTime() <= hasta.getTime()) {
    const tentativo = addUtcDays(inicio, DIAS_MAX_POR_PEDIDO - 1);
    const fin = tentativo.getTime() > hasta.getTime() ? hasta : tentativo;
    ventanas.push({ desde: inicio, hasta: fin });
    inicio = addUtcDays(fin, 1);
  }
  return ventanas;
}

function fechaParam(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function pedir<T>(ruta: string, params: Record<string, string>): Promise<{ resultado: T[] }> {
  const clave = process.env.LENOX_API_KEY?.trim();
  if (!clave) throw new Error("Falta LENOX_API_KEY");

  const url = new URL(BASE + ruta);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, { headers: { "LenoxBusinessAPI-Key": clave } });
  if (!res.ok) {
    // Sin traducir, a propósito: un diagnóstico que no se distingue de otro
    // no es un diagnóstico. Es la misma regla que con los errores de Google.
    const texto = await res.text();
    throw new Error(`Lenox respondió ${res.status}: ${texto.slice(0, 300)}`);
  }
  const cuerpo = await res.json();
  return { resultado: (cuerpo?.resultado ?? []) as T[] };
}

/** Todas las páginas de una ruta, hasta que una vuelve vacía. */
async function pedirTodo<T>(ruta: string, params: Record<string, string>): Promise<T[]> {
  const filas: T[] = [];
  let offset = 0;
  for (;;) {
    const { resultado } = await pedir<T>(ruta, { ...params, FilasExcluidas: String(offset) });
    filas.push(...resultado);
    if (resultado.length === 0) break;
    offset += resultado.length;
    // Cinturón: si la API ignorara FilasExcluidas devolvería siempre lo mismo
    // y esto no terminaría nunca.
    if (offset > LOTE_ESPERADO * 100) throw new Error("Lenox devolvió más páginas de las razonables; ¿ignora FilasExcluidas?");
  }
  return filas;
}

/** Las marcaciones de todos los empleados en un rango, partiendo el rango en ventanas de 7 días. */
export async function traerMarcaciones(desde: Date, hasta: Date): Promise<MarcacionLenox[]> {
  const filas: MarcacionLenox[] = [];
  for (const v of ventanasDe(desde, hasta)) {
    filas.push(
      ...(await pedirTodo<MarcacionLenox>("/marcaciones/getmarcaciones", {
        Desde: fechaParam(v.desde),
        Hasta: fechaParam(v.hasta),
        ExcluirDadosDeBaja: "false", // las bajas también fichan hasta su último día
      }))
    );
  }
  return filas;
}

/** El padrón completo de Lenox, bajas incluidas: el cotejo necesita ver las dos cosas. */
export async function traerEmpleados(): Promise<EmpleadoLenox[]> {
  return pedirTodo<EmpleadoLenox>("/empleados/getempleados", { ExcluirBajas: "false" });
}
```

- [ ] **Paso 5: Correr los tests**

```bash
npx vitest run lib/rrhh/lenox/cliente.test.ts
```

Esperado: PASA, 7 tests.

- [ ] **Paso 6: Commit**

```bash
git add lib/rrhh/lenox/tipos.ts lib/rrhh/lenox/cliente.ts lib/rrhh/lenox/cliente.test.ts
git commit -m "feat(rrhh): el cliente HTTP de la API de Lenox

Resuelve las dos cosas que la doc deja a medias: el tope de 7 días por
pedido, que parte cualquier rango en ventanas, y la paginación — la doc no
dice cuál es el tope de filas por respuesta, sólo expone FilasExcluidas como
offset, así que se pagina siempre y se corta con la página vacía en vez de
confiar en un número que no está escrito.

No interpreta nada: devuelve las filas como vienen. Los errores se propagan
con lo que dijo Lenox sin traducir.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Tarea 5: El agrupador

**Archivos:**
- Crear: `lib/rrhh/lenox/agrupar.ts`
- Test: `lib/rrhh/lenox/agrupar.test.ts`

- [ ] **Paso 1: Escribir el test que falla**

`lib/rrhh/lenox/agrupar.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { agruparPorLegajo } from "./agrupar";
import { toUtcDateOnly } from "../dates";
import type { MarcacionLenox } from "./tipos";

function dia(y: number, m: number, d: number) {
  return toUtcDateOnly(y, m - 1, d);
}

function marca(legajo: string, fecha: string, hora: string): MarcacionLenox {
  return {
    nombre: "A", apellido: "B", legajo,
    marcacion: `${fecha} ${hora}`, marcacionFecha: fecha, marcacionHora: hora,
    tipoMarcacion: "BIOMETRICO", comentario: null, reloj: "Reloj 1",
  };
}

describe("agruparPorLegajo", () => {
  it("agrupa por legajo y por día, y arma los tokens en orden de hora", () => {
    const porLegajo = agruparPorLegajo(
      [
        marca("PC_204", "2026-10-02", "16:03:00"),
        marca("PC_204", "2026-10-02", "07:58:00"),
        marca("PS_010", "2026-10-02", "06:00:00"),
      ],
      dia(2026, 10, 2),
      dia(2026, 10, 2)
    );

    expect([...porLegajo.keys()].sort()).toEqual(["PC_204", "PS_010"]);
    expect(porLegajo.get("PC_204")).toEqual([
      { fecha: dia(2026, 10, 2), tokens: [{ tipo: "E", hora: "07:58" }, { tipo: "S", hora: "16:03" }] },
    ]);
  });

  it("alterna E/S por posición: la letra la pone el agrupador, no Lenox", () => {
    const porLegajo = agruparPorLegajo(
      [
        marca("PC_001", "2026-10-02", "08:00:00"),
        marca("PC_001", "2026-10-02", "12:00:00"),
        marca("PC_001", "2026-10-02", "13:00:00"),
        marca("PC_001", "2026-10-02", "17:00:00"),
      ],
      dia(2026, 10, 2),
      dia(2026, 10, 2)
    );
    expect(porLegajo.get("PC_001")![0].tokens.map((t) => t.tipo)).toEqual(["E", "S", "E", "S"]);
  });

  it("genera los días del rango que no tienen ninguna marcación", () => {
    const porLegajo = agruparPorLegajo(
      [marca("PC_001", "2026-10-01", "08:00:00"), marca("PC_001", "2026-10-03", "08:00:00")],
      dia(2026, 10, 1),
      dia(2026, 10, 3)
    );
    const dias = porLegajo.get("PC_001")!;
    expect(dias).toHaveLength(3);
    expect(dias[1]).toEqual({ fecha: dia(2026, 10, 2), tokens: [] });
  });

  it("los días salen ordenados ascendente, que es lo que espera reconciliarTokens", () => {
    const porLegajo = agruparPorLegajo(
      [marca("PC_001", "2026-10-03", "08:00:00"), marca("PC_001", "2026-10-01", "08:00:00")],
      dia(2026, 10, 1),
      dia(2026, 10, 3)
    );
    expect(porLegajo.get("PC_001")!.map((d) => d.fecha.getTime())).toEqual([
      dia(2026, 10, 1).getTime(), dia(2026, 10, 2).getTime(), dia(2026, 10, 3).getTime(),
    ]);
  });

  it("descarta una marcación con fecha ilegible en vez de inventarle un día", () => {
    const porLegajo = agruparPorLegajo(
      [{ ...marca("PC_001", "2026-10-01", "08:00:00"), marcacionFecha: "", marcacionHora: "" }],
      dia(2026, 10, 1),
      dia(2026, 10, 1)
    );
    expect(porLegajo.get("PC_001")).toEqual([{ fecha: dia(2026, 10, 1), tokens: [] }]);
  });
});
```

- [ ] **Paso 2: Correrlo y ver que falla**

```bash
npx vitest run lib/rrhh/lenox/agrupar.test.ts
```

Esperado: FALLA — el módulo `./agrupar` no existe.

- [ ] **Paso 3: Escribir el agrupador**

`lib/rrhh/lenox/agrupar.ts`:

```ts
import { addUtcDays, toUtcDateOnly } from "../dates";
import type { DiaMarcacionesTokens, TokenMarcacion } from "../excelImport";
import type { MarcacionLenox } from "./tipos";

/** "2026-10-02" → el día calendario como medianoche UTC. Null si no se entiende. */
function fechaDe(valor: string): Date | null {
  const m = valor.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return toUtcDateOnly(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** "07:58:00" → "07:58". Null si no se entiende. */
function horaDe(valor: string): string | null {
  const m = valor.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

/**
 * Convierte las marcaciones sueltas que devuelve la API en la forma que espera
 * `reconciliarTokens`: por legajo, un día por cada día del rango —incluidos
 * los que no tienen ninguna marca— con los tokens ordenados por hora.
 *
 * DOS COSAS QUE PARECEN DE MÁS Y NO LO SON:
 *
 * 1. **Los días vacíos se generan.** El Excel trae una fila por día aunque la
 *    celda esté vacía, y `reconciliarTokens` usa esos días para decidir cerrar
 *    un turno pendiente. Se verificó que la guarda de 2 a 14 horas del cruce
 *    de medianoche ya rechaza cualquier cierre lejano, así que el resultado es
 *    el mismo con o sin ellos: lo que cambia es el texto del aviso. Se generan
 *    igual porque vamos a mantener los dos caminos de carga, y que produzcan
 *    la misma salida palabra por palabra es lo que permite comparar uno contra
 *    el otro cuando algo no cierre.
 *
 * 2. **El tipo E/S lo pone esto, alternando por posición.** La API no dice si
 *    una marca es entrada o salida. Da igual: `pairTokens` empareja por
 *    posición y no por la letra, justamente porque en el borde entre días la
 *    letra del Excel tampoco era confiable. La letra queda sólo para que los
 *    mensajes se lean.
 */
export function agruparPorLegajo(
  marcaciones: MarcacionLenox[],
  desde: Date,
  hasta: Date
): Map<string, DiaMarcacionesTokens[]> {
  // legajo → "YYYY-MM-DD" → horas "HH:MM"
  const horasPorDia = new Map<string, Map<string, string[]>>();

  for (const m of marcaciones) {
    const legajo = String(m.legajo ?? "").trim();
    if (!legajo) continue;
    const fecha = fechaDe(String(m.marcacionFecha ?? ""));
    const hora = horaDe(String(m.marcacionHora ?? ""));
    if (!fecha || !hora) continue; // una fila ilegible se descarta, no se le inventa un día

    const clave = fecha.toISOString().slice(0, 10);
    if (!horasPorDia.has(legajo)) horasPorDia.set(legajo, new Map());
    const dias = horasPorDia.get(legajo)!;
    if (!dias.has(clave)) dias.set(clave, []);
    dias.get(clave)!.push(hora);
  }

  const resultado = new Map<string, DiaMarcacionesTokens[]>();
  for (const [legajo, dias] of horasPorDia) {
    const delLegajo: DiaMarcacionesTokens[] = [];
    for (let f = desde; f.getTime() <= hasta.getTime(); f = addUtcDays(f, 1)) {
      const horas = (dias.get(f.toISOString().slice(0, 10)) ?? []).slice().sort();
      const tokens: TokenMarcacion[] = horas.map((hora, i) => ({
        tipo: i % 2 === 0 ? "E" : "S",
        hora,
      }));
      delLegajo.push({ fecha: f, tokens });
    }
    resultado.set(legajo, delLegajo);
  }
  return resultado;
}
```

- [ ] **Paso 4: Correr los tests**

```bash
npx vitest run lib/rrhh/lenox/agrupar.test.ts
```

Esperado: PASA, 5 tests.

- [ ] **Paso 5: Commit**

```bash
git add lib/rrhh/lenox/tipos.ts lib/rrhh/lenox/agrupar.ts lib/rrhh/lenox/agrupar.test.ts
git commit -m "feat(rrhh): agrupar las marcaciones sueltas de Lenox en días con tokens

Es la pieza que permite reusar reconciliarMarcaciones entero en vez de
reescribirlo: la API devuelve marcaciones sueltas y esto las deja en la misma
forma que recibe hoy el camino del Excel.

Genera también los días del rango sin ninguna marca. Se verificó que no
cambia el resultado —la guarda de 2 a 14 horas ya rechaza los cierres
lejanos—, pero sí el texto del aviso, y que los dos caminos den idéntico es
lo que va a permitir compararlos cuando algo no cierre.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Lo que cambió respecto del bloque de arriba, al construirlo

Tres cosas salieron de la revisión y están en el código, no acá. Si volvés a
leer este plan, la fuente de verdad es `lib/rrhh/lenox/agrupar.ts`:

1. **`tipos.ts` se creó en esta tarea**, no en la 4: el agrupador lo necesita y
   la 4 está bloqueada esperando la clave de la API.
2. **El legajo se registra en el Map antes de leer fecha y hora.** El bloque de
   arriba hace `continue` antes, con lo que un legajo cuya única marca viene
   ilegible no entra al Map — y eso contradice el quinto test de este mismo
   plan. Una marcación con fecha fuera de `[desde, hasta]` se descarta, pero su
   legajo igual queda, con los días vacíos.
3. **La firma devuelve `{ porLegajo, descartadas }`**, no un `Map` pelado.
   `descartadas` cuenta las filas que no se pudieron leer, separadas por
   motivo. Sin eso, un día en que la API devolviera basura se vería como una
   sincronización exitosa que cargó cero.

Y `fechaDe`/`horaDe` validan que la fecha y la hora **existan**, no sólo que
tengan el formato: sin eso `"2026-02-31"` entraba como 3 de marzo, que es
exactamente el día inventado que el quinto test dice evitar.

---

## Tarea 6: La capa que decide (pura)

Las tres protecciones del spec viven acá, sin tocar la base. Es la parte que
hoy no tiene un solo test porque vive adentro de una ruta.

**Archivos:**
- Crear: `lib/rrhh/fichadas/decidir.ts`
- Test: `lib/rrhh/fichadas/decidir.test.ts`

- [ ] **Paso 1: Escribir el test que falla**

`lib/rrhh/fichadas/decidir.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { decidirQueAplicar, claveDia, type TurnoNuevo, type ContextoDeDecision } from "./decidir";
import { toUtcDateOnly, localDateTime } from "../dates";

function dia(y: number, m: number, d: number) {
  return toUtcDateOnly(y, m - 1, d);
}

function turno(empleadoId: string, f: Date, entrada: [number, number], salida: [number, number] | null): TurnoNuevo {
  return {
    empleadoId,
    legajo: "PC_204",
    fecha: f,
    horaEntrada: localDateTime(f, entrada[0], entrada[1]),
    horaSalida: salida ? localDateTime(f, salida[0], salida[1]) : null,
  };
}

const vacio: ContextoDeDecision = {
  diasCorregidos: new Set(),
  diasLiquidados: new Set(),
  guardadas: new Map(),
};

describe("decidirQueAplicar", () => {
  it("sin nada que proteger, inserta todo y marca los días para borrar", () => {
    const t = turno("emp-1", dia(2026, 10, 2), [8, 0], [16, 0]);
    const d = decidirQueAplicar([t], vacio, true);
    expect(d.aInsertar).toEqual([t]);
    expect(d.diasABorrar).toEqual([{ empleadoId: "emp-1", fecha: "2026-10-02" }]);
    expect(d.salteados).toEqual([]);
  });

  it("descarta turnos repetidos dentro del mismo lote", () => {
    const t = turno("emp-1", dia(2026, 10, 2), [8, 0], [16, 0]);
    const d = decidirQueAplicar([t, { ...t }], vacio, true);
    expect(d.aInsertar).toHaveLength(1);
  });

  it("saltea un día corregido a mano y no lo borra", () => {
    const t = turno("emp-1", dia(2026, 10, 2), [8, 0], [16, 0]);
    const ctx: ContextoDeDecision = {
      ...vacio,
      diasCorregidos: new Set([claveDia("emp-1", "2026-10-02")]),
    };
    const d = decidirQueAplicar([t], ctx, true);
    expect(d.aInsertar).toEqual([]);
    expect(d.diasABorrar).toEqual([]);
    expect(d.salteados[0].motivo).toBe("corregido");
  });

  it("saltea un día dentro de una liquidación cerrada", () => {
    const t = turno("emp-1", dia(2026, 10, 2), [8, 0], [16, 0]);
    const ctx: ContextoDeDecision = {
      ...vacio,
      diasLiquidados: new Set([claveDia("emp-1", "2026-10-02")]),
    };
    const d = decidirQueAplicar([t], ctx, true);
    expect(d.aInsertar).toEqual([]);
    expect(d.salteados[0].motivo).toBe("liquidado");
  });

  it("al saltear, avisa si lo que trae Lenox difiere de lo guardado", () => {
    const f = dia(2026, 10, 2);
    const t = turno("emp-1", f, [8, 12], [16, 3]);
    const ctx: ContextoDeDecision = {
      ...vacio,
      diasCorregidos: new Set([claveDia("emp-1", "2026-10-02")]),
      guardadas: new Map([
        [claveDia("emp-1", "2026-10-02"), [{
          horaEntrada: localDateTime(f, 7, 58).toISOString(),
          horaSalida: localDateTime(f, 16, 3).toISOString(),
        }]],
      ]),
    };
    const d = decidirQueAplicar([t], ctx, true);
    expect(d.salteados[0].divergencia).toBe("guardado 07:58–16:03, Lenox trae 08:12–16:03");
  });

  it("al saltear, NO avisa si coincide con lo guardado", () => {
    const f = dia(2026, 10, 2);
    const t = turno("emp-1", f, [7, 58], [16, 3]);
    const ctx: ContextoDeDecision = {
      ...vacio,
      diasCorregidos: new Set([claveDia("emp-1", "2026-10-02")]),
      guardadas: new Map([
        [claveDia("emp-1", "2026-10-02"), [{
          horaEntrada: localDateTime(f, 7, 58).toISOString(),
          horaSalida: localDateTime(f, 16, 3).toISOString(),
        }]],
      ]),
    };
    const d = decidirQueAplicar([t], ctx, true);
    expect(d.salteados[0].divergencia).toBeNull();
  });

  it("con protegerCorregidos en false, el día corregido se pisa (es el camino del Excel)", () => {
    const t = turno("emp-1", dia(2026, 10, 2), [8, 0], [16, 0]);
    const ctx: ContextoDeDecision = {
      ...vacio,
      diasCorregidos: new Set([claveDia("emp-1", "2026-10-02")]),
    };
    const d = decidirQueAplicar([t], ctx, false);
    expect(d.aInsertar).toEqual([t]);
    expect(d.salteados).toEqual([]);
  });

  it("una liquidación cerrada se respeta aunque sea el camino del Excel", () => {
    const t = turno("emp-1", dia(2026, 10, 2), [8, 0], [16, 0]);
    const ctx: ContextoDeDecision = {
      ...vacio,
      diasLiquidados: new Set([claveDia("emp-1", "2026-10-02")]),
    };
    const d = decidirQueAplicar([t], ctx, false);
    expect(d.aInsertar).toEqual([]);
    expect(d.salteados[0].motivo).toBe("liquidado");
  });
});
```

- [ ] **Paso 2: Correrlo y ver que falla**

```bash
npx vitest run lib/rrhh/fichadas/decidir.test.ts
```

Esperado: FALLA — el módulo `./decidir` no existe.

- [ ] **Paso 3: Escribir la capa de decisión**

`lib/rrhh/fichadas/decidir.ts`:

```ts
import { formatHHMM } from "../dates";

export interface TurnoNuevo {
  empleadoId: string;
  legajo: string; // sólo para que los mensajes se puedan leer
  fecha: Date; // día calendario (UTC-medianoche)
  horaEntrada: Date;
  horaSalida: Date | null;
}

/** Lo que ya está guardado en un día, reducido a lo único que se compara. */
export interface FichadaGuardada {
  horaEntrada: string; // ISO
  horaSalida: string | null; // ISO
}

export interface ContextoDeDecision {
  /** Claves `claveDia()` de los (empleado, día) que tocó una persona. */
  diasCorregidos: Set<string>;
  /** Claves `claveDia()` de los (empleado, día) dentro de una liquidación CERRADA. */
  diasLiquidados: Set<string>;
  /** Lo guardado hoy, para poder decir en qué difiere cuando se saltea. */
  guardadas: Map<string, FichadaGuardada[]>;
}

export type MotivoSalteo = "corregido" | "liquidado";

export interface DiaSalteado {
  empleadoId: string;
  legajo: string;
  fecha: string; // "YYYY-MM-DD"
  motivo: MotivoSalteo;
  /** En qué difiere lo que trae Lenox de lo guardado. Null si coinciden. */
  divergencia: string | null;
}

export interface Decision {
  aInsertar: TurnoNuevo[];
  diasABorrar: { empleadoId: string; fecha: string }[];
  salteados: DiaSalteado[];
}

export function claveDia(empleadoId: string, fecha: string): string {
  return `${empleadoId}|${fecha}`;
}

function fechaStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function tramo(entrada: string, salida: string | null): string {
  return `${formatHHMM(new Date(entrada))}–${salida ? formatHHMM(new Date(salida)) : "?"}`;
}

/**
 * Qué se inserta, qué día se reemplaza, qué se saltea y qué se avisa.
 *
 * Es puro a propósito: toda esta lógica vivía adentro de
 * `app/api/rrhh/fichadas/import/confirm/route.ts` y por eso no tenía un solo
 * test. Ahora la usan los dos caminos de carga —el Excel y la sincronización
 * con Lenox—, que es lo que impide que se vayan separando.
 *
 * `protegerCorregidos` es false para el Excel: quien sube un archivo a mano
 * está haciendo una elección deliberada sobre un período, igual que siempre.
 * El cron no elige nada, así que para Lenox va true. La liquidación cerrada,
 * en cambio, se respeta en los dos casos: eso no es una elección, es un mes
 * ya pagado.
 */
export function decidirQueAplicar(
  turnos: TurnoNuevo[],
  ctx: ContextoDeDecision,
  protegerCorregidos: boolean
): Decision {
  // Repetidos dentro del propio lote. Misma firma que usaba la ruta.
  const firma = (t: TurnoNuevo) =>
    `${t.empleadoId}|${t.fecha.getTime()}|${t.horaEntrada.getTime()}|${t.horaSalida?.getTime() ?? "null"}`;
  const vistas = new Set<string>();
  const sinRepetir = turnos.filter((t) => {
    const f = firma(t);
    if (vistas.has(f)) return false;
    vistas.add(f);
    return true;
  });

  const aInsertar: TurnoNuevo[] = [];
  const diasABorrar: { empleadoId: string; fecha: string }[] = [];
  const salteados: DiaSalteado[] = [];
  const diasVistos = new Set<string>();
  const diasYaSalteados = new Set<string>();

  for (const t of sinRepetir) {
    const fecha = fechaStr(t.fecha);
    const clave = claveDia(t.empleadoId, fecha);

    const liquidado = ctx.diasLiquidados.has(clave);
    const corregido = protegerCorregidos && ctx.diasCorregidos.has(clave);

    if (liquidado || corregido) {
      if (!diasYaSalteados.has(clave)) {
        diasYaSalteados.add(clave);
        salteados.push({
          empleadoId: t.empleadoId,
          legajo: t.legajo,
          fecha,
          // Si el día está en los dos, manda el que no se puede levantar.
          motivo: liquidado ? "liquidado" : "corregido",
          divergencia: divergenciaDe(ctx.guardadas.get(clave) ?? [], sinRepetir, clave),
        });
      }
      continue;
    }

    aInsertar.push(t);
    if (!diasVistos.has(clave)) {
      diasVistos.add(clave);
      diasABorrar.push({ empleadoId: t.empleadoId, fecha });
    }
  }

  return { aInsertar, diasABorrar, salteados };
}

/**
 * En qué difiere lo que trae Lenox de lo guardado, en palabras. Null si
 * coinciden: avisar de algo que no cambió es ruido, y el ruido hace que nadie
 * lea los avisos que sí importan.
 */
function divergenciaDe(
  guardadas: FichadaGuardada[],
  todos: TurnoNuevo[],
  clave: string
): string | null {
  const nuevos = todos.filter((t) => claveDia(t.empleadoId, fechaStr(t.fecha)) === clave);
  const deLenox = nuevos
    .map((t) => tramo(t.horaEntrada.toISOString(), t.horaSalida?.toISOString() ?? null))
    .sort();
  const deLaBase = guardadas.map((g) => tramo(g.horaEntrada, g.horaSalida)).sort();

  if (deLaBase.length === 0) return null; // no hay con qué comparar
  if (deLaBase.join(" · ") === deLenox.join(" · ")) return null;
  return `guardado ${deLaBase.join(" · ")}, Lenox trae ${deLenox.join(" · ")}`;
}
```

- [ ] **Paso 4: Correr los tests**

```bash
npx vitest run lib/rrhh/fichadas/decidir.test.ts
```

Esperado: PASA, 8 tests.

- [ ] **Paso 5: Commit**

```bash
git add lib/rrhh/fichadas/decidir.ts lib/rrhh/fichadas/decidir.test.ts
git commit -m "feat(rrhh): la decisión de qué fichadas aplicar, pura y testeada

Esta lógica vivía adentro de confirm/route.ts y por eso no tenía un solo
test. Sale a lib/ con las tres protecciones del spec: el día que tocó una
persona, el día dentro de una liquidación cerrada, y el aviso de en qué
difiere lo que trae Lenox de lo guardado cuando se saltea.

El Excel no protege los días corregidos y Lenox sí: quien sube un archivo
elige pisar un período, el cron no elige nada. La liquidación cerrada se
respeta en los dos, porque eso no es una elección.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Tarea 7: La capa que escribe

**Requiere la Tarea 2 corrida.** Es el IO alrededor de `decidir.ts`: lee el
contexto de la base, aplica, recalcula.

**Archivos:**
- Crear: `lib/rrhh/fichadas/aplicar.ts`

- [ ] **Paso 1: Escribir el módulo**

`lib/rrhh/fichadas/aplicar.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import { reconciliarTokens, horaStringToDate, type DiaMarcacionesTokens } from "../excelImport";
import { recalcularEmpleadoPeriodo } from "../engine/recalcular";
import { formatHHMM } from "../dates";
import {
  decidirQueAplicar, claveDia,
  type TurnoNuevo, type ContextoDeDecision, type FichadaGuardada, type DiaSalteado,
} from "./decidir";

/** Los días de un empleado, ya ordenados ascendente. */
export interface DiasDeEmpleado {
  empleadoId: string;
  legajo: string;
  dias: DiaMarcacionesTokens[];
}

export interface ResultadoAplicar {
  insertados: number;
  reemplazados: number;
  salteados: DiaSalteado[];
  avisos: string[];
}

function fechaStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * El alta de fichadas, compartida por los dos caminos de carga: el import de
 * Excel y la sincronización con Lenox.
 *
 * Está acá y no en la ruta porque el Excel se queda como respaldo, y dos
 * caminos de escritura separados se van separando — y el que casi no se usa
 * es el que se pudre sin que nadie lo note.
 */
export async function aplicarDias(
  admin: SupabaseClient,
  empleados: DiasDeEmpleado[],
  opciones: { batchId: string; protegerCorregidos: boolean }
): Promise<ResultadoAplicar> {
  const turnos: TurnoNuevo[] = [];
  const avisos: string[] = [];

  for (const emp of empleados) {
    if (emp.dias.length === 0) continue;

    // Si de una carga anterior quedó un turno sin marcación de salida, se
    // encadena acá para que el primer dato de este lote pueda cerrarlo en vez
    // de quedar abierto para siempre.
    const { data: abierto } = await admin
      .from("fichadas")
      .select("id, fecha, hora_entrada")
      .eq("empleado_id", emp.empleadoId)
      .is("hora_salida", null)
      .lt("fecha", fechaStr(emp.dias[0].fecha))
      .order("fecha", { ascending: false })
      .limit(1)
      .maybeSingle();

    const abiertoFecha = abierto ? new Date(abierto.fecha as string) : null;
    const abiertoPrevio = abierto
      ? { fecha: abiertoFecha!, entradaStr: formatHHMM(new Date(abierto.hora_entrada as string)) }
      : null;

    const { turnos: resueltos, avisos: avisosDelEmpleado } = reconciliarTokens(emp.dias, abiertoPrevio);

    for (const t of resueltos) {
      // El turno que cierra una fichada ya abierta se completa con un update:
      // esa fila ya existe y no entra por el camino de borrar-e-insertar.
      if (abierto && abiertoFecha && t.fecha.getTime() === abiertoFecha.getTime()) {
        if (t.salidaStr) {
          await admin
            .from("fichadas")
            .update({ hora_salida: horaStringToDate(t.fechaSalida, t.salidaStr).toISOString() })
            .eq("id", abierto.id);
          await recalcularEmpleadoPeriodo(admin, emp.empleadoId, t.fecha, t.fechaSalida);
        }
        continue;
      }
      turnos.push({
        empleadoId: emp.empleadoId,
        legajo: emp.legajo,
        fecha: t.fecha,
        horaEntrada: horaStringToDate(t.fecha, t.entradaStr),
        horaSalida: t.salidaStr ? horaStringToDate(t.fechaSalida, t.salidaStr) : null,
      });
    }

    for (const a of avisosDelEmpleado) {
      avisos.push(`Legajo ${emp.legajo}, ${fechaStr(a.fecha)}: ${a.mensaje}`);
    }
  }

  const ctx = await contextoDe(admin, turnos);
  const decision = decidirQueAplicar(turnos, ctx, opciones.protegerCorregidos);

  let reemplazados = 0;
  for (const d of decision.diasABorrar) {
    const { data: borrados } = await admin
      .from("fichadas")
      .delete()
      .eq("empleado_id", d.empleadoId)
      .eq("origen", "IMPORTADO")
      .eq("fecha", d.fecha)
      .select("id");
    reemplazados += borrados?.length ?? 0;
  }

  const filas = decision.aInsertar.map((t) => ({
    empleado_id: t.empleadoId,
    fecha: fechaStr(t.fecha),
    hora_entrada: t.horaEntrada.toISOString(),
    hora_salida: t.horaSalida ? t.horaSalida.toISOString() : null,
    origen: "IMPORTADO",
    import_batch_id: opciones.batchId,
  }));
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await admin.from("fichadas").insert(filas.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }

  // Recalcular una vez por empleado, con su rango completo.
  const rangos = new Map<string, { min: Date; max: Date }>();
  for (const t of decision.aInsertar) {
    const r = rangos.get(t.empleadoId);
    if (!r) rangos.set(t.empleadoId, { min: t.fecha, max: t.fecha });
    else {
      if (t.fecha < r.min) r.min = t.fecha;
      if (t.fecha > r.max) r.max = t.fecha;
    }
  }
  for (const [empleadoId, r] of rangos) {
    await recalcularEmpleadoPeriodo(admin, empleadoId, r.min, r.max);
  }

  for (const s of decision.salteados) {
    const motivo = s.motivo === "liquidado" ? "liquidación cerrada" : "corregido a mano";
    avisos.push(
      `Legajo ${s.legajo}, ${s.fecha}: no se tocó (${motivo})` +
        (s.divergencia ? ` — ${s.divergencia}` : "")
    );
  }

  return { insertados: decision.aInsertar.length, reemplazados, salteados: decision.salteados, avisos };
}

/**
 * Los días protegidos y lo guardado hoy, para los turnos de este lote.
 *
 * OJO CON `guardadas`, QUE TIENE UN CONTRATO IMPLÍCITO: para `decidir.ts`,
 * una clave ausente significa "ese día no tiene ninguna fichada", y con eso
 * avisa `"guardado sin fichadas, Lenox trae …"` — que es el caso real de la
 * marca fantasma que alguien borró y el cron recrearía. Si esta función no
 * leyera de verdad lo guardado de **todos** los días protegidos, cada día
 * salteado saldría con esa leyenda: una falsa alarma masiva que haría que
 * nadie vuelva a leer los avisos.
 *
 * Se cumple porque un día sólo se saltea si trajo al menos un turno, así que
 * su fecha cae dentro de `[desde, hasta]` y su empleado está en `delLote`.
 * Si alguien cambia ese filtro, tiene que volver a comprobarlo.
 */
async function contextoDe(admin: SupabaseClient, turnos: TurnoNuevo[]): Promise<ContextoDeDecision> {
  const vacio: ContextoDeDecision = {
    diasCorregidos: new Set(), diasLiquidados: new Set(), guardadas: new Map(),
  };
  if (turnos.length === 0) return vacio;

  const empleadoIds = [...new Set(turnos.map((t) => t.empleadoId))];
  const fechas = turnos.map((t) => fechaStr(t.fecha)).sort();
  const desde = fechas[0];
  const hasta = fechas[fechas.length - 1];

  // Se filtra por rango de fechas y no con un .in() de ids: con muchos ids
  // PostgREST arma una URL que rechaza con un 400 sin decir por qué.
  //
  // Y va con traerTodo y no con .limit(): PostgREST corta en 1000 filas y no
  // avisa. `fichadas` tiene 4.672 y crece todos los días; un mes de un lote
  // grande pasa el corte sin que nada falle, y el contexto incompleto se
  // traduce en días que se pisan porque "no estaban protegidos".
  // traerTodo recibe una función (desde, hasta) y le pasa .range() — ver la
  // firma en lib/core/paginado.ts:13.
  //
  // El `.order("id")` NO es decorativo. `.range()` es LIMIT/OFFSET, y sin un
  // orden determinístico Postgres no garantiza que dos páginas consecutivas
  // no repitan ni saltean filas. Acá eso no daría un error: daría una
  // divergencia falsa, o un "guardado sin fichadas" falso, en días que no
  // cambiaron — y entonces nadie vuelve a leer los avisos. `fichadas` ya
  // tiene 4.700 filas y crece todos los días, así que pasar las 1000 de una
  // página es cuestión de tiempo.
  const corregidos = await traerTodo<{ empleado_id: string; fecha: string }>((d, h) =>
    admin.from("rrhh_dias_corregidos").select("empleado_id, fecha")
      .gte("fecha", desde).lte("fecha", hasta).order("id").range(d, h)
  );
  const liquidaciones = await traerTodo<{ empleado_id: string; fecha_desde: string; fecha_hasta: string }>((d, h) =>
    admin.from("liquidaciones").select("empleado_id, fecha_desde, fecha_hasta")
      .eq("estado", "CERRADA").lte("fecha_desde", hasta).gte("fecha_hasta", desde).order("id").range(d, h)
  );
  const existentes = await traerTodo<{ empleado_id: string; fecha: string; hora_entrada: string; hora_salida: string | null }>((d, h) =>
    admin.from("fichadas").select("empleado_id, fecha, hora_entrada, hora_salida")
      .gte("fecha", desde).lte("fecha", hasta).order("id").range(d, h)
  );

  const delLote = new Set(empleadoIds);

  const diasCorregidos = new Set<string>();
  for (const c of corregidos) {
    if (delLote.has(c.empleado_id)) diasCorregidos.add(claveDia(c.empleado_id, c.fecha));
  }

  const diasLiquidados = new Set<string>();
  for (const l of liquidaciones) {
    if (!delLote.has(l.empleado_id)) continue;
    for (const t of turnos) {
      if (t.empleadoId !== l.empleado_id) continue;
      const f = fechaStr(t.fecha);
      if (f >= l.fecha_desde && f <= l.fecha_hasta) diasLiquidados.add(claveDia(l.empleado_id, f));
    }
  }

  const guardadas = new Map<string, FichadaGuardada[]>();
  for (const f of existentes) {
    if (!delLote.has(f.empleado_id)) continue;
    const clave = claveDia(f.empleado_id, f.fecha);
    if (!guardadas.has(clave)) guardadas.set(clave, []);
    guardadas.get(clave)!.push({ horaEntrada: f.hora_entrada, horaSalida: f.hora_salida });
  }

  return { diasCorregidos, diasLiquidados, guardadas };
}
```

- [ ] **Paso 2: Verificar que compila**

```bash
npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Paso 3: Commit**

```bash
git add lib/rrhh/fichadas/aplicar.ts
git commit -m "feat(rrhh): el alta de fichadas, fuera de la ruta y compartida

Lee el contexto (días corregidos, liquidaciones cerradas, lo guardado),
llama a la capa pura que decide, escribe y recalcula. La van a usar el
import de Excel y la sincronización con Lenox, que es lo que evita que los
dos caminos se vayan separando.

El contexto se filtra por rango de fechas y no con un .in() de ids: con
muchos ids PostgREST devuelve un 400 sin decir por qué.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Lo que cambió respecto del bloque de arriba, al construirlo

Cinco cosas. La fuente de verdad es `lib/rrhh/fichadas/aplicar.ts`.

1. **El rango del recálculo incluye `fechaSalida`, no sólo `fecha`.** Era un
   **bug del plan**: un turno que cruza la medianoche aporta horas al día
   siguiente, y si ese día no tenía turnos propios, nadie lo recalculaba. La
   ruta vieja sí marcaba las dos fechas. Además se difieren los cierres para
   que haya **un solo** recálculo por empleado en vez de dos.
2. **El cierre de una fichada abierta pasa por las protecciones.** En el bloque
   de arriba el `update` corría antes de `decidir.ts` y sin protección, así que
   una liquidación cerrada con un turno nocturno sin salida **se movía sola**
   cuando entraba la marca del día siguiente. Ahora el cierre se aplica después
   de conocer el contexto; si el día está protegido no se cierra y sale un
   aviso. El `update` lleva además `.is("hora_salida", null)` para no pisar una
   salida que alguien cargó a mano mientras tanto.
3. **`abiertoPrevio` es una sola consulta, no una por empleado.** Eran 68
   consultas secuenciales. Ahora se traen todas las abiertas anteriores al lote
   —con `traerTodo` y `.order("id")`— y la elección por empleado la hace
   `elegirAbiertoPrevio`, que es pura y está testeada en `decidir.ts`.
4. **El borrado se agrupa por empleado**, con las fechas en un `.in()` cortado
   en tandas de 200 (unos 2 KB de URL, bien lejos del límite que hace que
   PostgREST devuelva un 400 mudo). Pasa de 476 consultas a 68. Y **se chequea
   el `error` del borrado**, que el bloque de arriba ignoraba: un borrado
   fallido seguía de largo y dejaba el día duplicado, con horas que se pagan
   dos veces.
5. **Las fichadas abiertas viejas se ignoran para el encadenamiento y se
   informan una sola vez.** Bajo la guarda de 2 a 14 horas, una abierta de más
   de un día antes del lote **no puede cerrarse** con esos datos: pasarla sólo
   produce un aviso que no lleva a ninguna acción. Con 23 empleados con una
   abierta vieja eso eran hasta 23 líneas fijas en cada `log_detalle`, todos
   los días. Ahora salen en un aviso agregado que dice cuántas son, desde
   cuándo y qué hacer. Vale para los dos caminos de carga.

**Riesgo asumido, escrito en el código:** si el `insert` falla a mitad de los
lotes de 500, el día ya fue borrado y queda vacío o a medias. Se cura en la
próxima corrida —el cron, el botón, o volver a subir el Excel—, salvo que el
día quede fuera de la ventana de 7 días. Invertir el orden (insertar antes de
borrar) se descartó: un fallo del borrado dejaría el día duplicado, que es
peor, porque esas horas se pagan.

---

## Tarea 8: El import de Excel pasa a usar `aplicar.ts`

**Requiere la Tarea 7.** El objetivo es que el comportamiento del Excel **no
cambie**: lo único que cambia es por dónde pasa.

**Archivos:**
- Modificar: `app/api/rrhh/fichadas/import/confirm/route.ts`

- [ ] **Paso 1: Medir cómo se comporta hoy, antes de tocar nada**

```bash
node --env-file=.env.local -e "
const {createClient}=require('@supabase/supabase-js');
const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
(async()=>{
  const {count}=await s.from('fichadas').select('*',{count:'exact',head:true});
  const {data}=await s.from('fichadas').select('empleado_id,fecha,hora_entrada,hora_salida').order('fecha',{ascending:false}).limit(50);
  console.log('total fichadas:',count);
  console.log(JSON.stringify(data));
})();
" > "$TEMP/fichadas-antes.json"
cat "$TEMP/fichadas-antes.json" | head -3
```

Guardalo: al final de la tarea las 50 últimas fichadas tienen que ser las
mismas.

- [ ] **Paso 2: Reescribir el cuerpo del route**

Reemplazar todo desde `const admin = createAdminClient();` hasta el `return`
final por esto, dejando intacto lo de arriba (la validación del cuerpo y la
lectura del staging):

```ts
  const admin = createAdminClient();

  const { data: empleadosData } = await admin.from("empleados").select("id, legajo");
  const legajoToId = new Map((empleadosData ?? []).map((e) => [e.legajo.trim(), e.id]));

  const errores: string[] = [];
  interface FilaValida { idx: number; legajo: string; employeeId: string; fecha: Date; row: Record<string, unknown> }
  const filasValidas: FilaValida[] = [];

  hoja.rows.forEach((row, idx) => {
    const legajoRaw = String(row[mapping.legajo] ?? "").trim();
    if (!legajoRaw) return;
    const employeeId = legajoToId.get(legajoRaw);
    if (!employeeId) {
      errores.push(`Fila ${idx + 2}: legajo "${legajoRaw}" no encontrado`);
      return;
    }
    const fecha = toDateOnlyFromCell(row[mapping.fecha]);
    if (!fecha) {
      errores.push(`Fila ${idx + 2}: fecha inválida`);
      return;
    }
    filasValidas.push({ idx, legajo: legajoRaw, employeeId, fecha, row });
  });

  const { data: batch, error: batchErr } = await admin
    .from("rrhh_import_batches")
    .insert({ nombre_archivo: entry.nombreArchivo, usuario_id: user!.id })
    .select("id")
    .single();
  if (batchErr) return NextResponse.json({ error: batchErr.message }, { status: 500 });

  let resultado: ResultadoAplicar;

  if (mapping.modo === "combinado") {
    const porEmpleado = new Map<string, FilaValida[]>();
    for (const f of filasValidas) {
      if (!porEmpleado.has(f.employeeId)) porEmpleado.set(f.employeeId, []);
      porEmpleado.get(f.employeeId)!.push(f);
    }

    const empleados: DiasDeEmpleado[] = [];
    for (const [employeeId, filas] of porEmpleado) {
      filas.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
      const dias = filas.map((f) => {
        const raw = String(f.row[mapping.marcaciones ?? ""] ?? "").trim();
        if (raw && tokenizeMarcaciones(raw).length === 0) {
          errores.push(`Fila ${f.idx + 2} (legajo ${filas[0].legajo}): no se pudieron interpretar las marcaciones "${raw}"`);
        }
        return { fecha: f.fecha, tokens: tokenizeMarcaciones(raw) };
      });
      empleados.push({ empleadoId: employeeId, legajo: filas[0].legajo, dias });
    }

    resultado = await aplicarDias(admin, empleados, { batchId: batch.id, protegerCorregidos: false });
  } else {
    // Modo "separado": las horas vienen en dos columnas, ya emparejadas. No
    // pasa por la reconciliación porque no hay nada que reconciliar.
    const empleados: DiasDeEmpleado[] = [];
    for (const f of filasValidas) {
      const horaEntrada = combineFechaHora(f.fecha, f.row[mapping.horaEntrada ?? ""]);
      if (!horaEntrada) {
        errores.push(`Fila ${f.idx + 2}: hora de entrada inválida`);
        continue;
      }
      const horaSalida = mapping.horaSalida ? combineFechaHora(f.fecha, f.row[mapping.horaSalida]) : null;
      const tokens = [{ tipo: "E" as const, hora: formatHHMM(horaEntrada) }];
      if (horaSalida) tokens.push({ tipo: "S" as const, hora: formatHHMM(horaSalida) });
      empleados.push({ empleadoId: f.employeeId, legajo: f.legajo, dias: [{ fecha: f.fecha, tokens }] });
    }
    resultado = await aplicarDias(admin, empleados, { batchId: batch.id, protegerCorregidos: false });
  }

  errores.push(...resultado.avisos);

  await admin
    .from("rrhh_import_batches")
    .update({
      cantidad_registros: resultado.insertados,
      cantidad_errores: errores.length,
      log_detalle: errores.length ? errores.join("\n") : null,
    })
    .eq("id", batch.id);

  await borrarStaging(supabase, token);
  return NextResponse.json({
    batchId: batch.id,
    insertados: resultado.insertados,
    reemplazados: resultado.reemplazados,
    errores,
  });
```

Ajustar los imports del archivo a:

```ts
import { tokenizeMarcaciones, toDateOnlyFromCell, type ParsedSheet } from "@/lib/rrhh/excelImport";
import { localDateTime, formatHHMM } from "@/lib/rrhh/dates";
import { aplicarDias, type DiasDeEmpleado, type ResultadoAplicar } from "@/lib/rrhh/fichadas/aplicar";
```

Borrar los imports que quedan sin uso (`horaStringToDate`,
`reconciliarMarcaciones`, `recalcularEmpleadoPeriodo`).

- [ ] **Paso 2 bis: Cerrar los dos comentarios que esta migración vuelve falsos**

En `lib/rrhh/fichadas/decidir.ts`, el comentario del dedup dice *"Misma firma
que usaba la ruta"*. Deja de ser cierto en este mismo paso, porque la ruta
pasa a usar esta función. Reemplazalo por una descripción de **qué cuenta
como repetido** (mismo empleado, mismo día, misma entrada y misma salida), que
es lo que alguien necesita saber.

De paso, los tres `Set` de control de `decidirQueAplicar` se distinguen a
medias: `vistas` guarda firmas de turnos, no días, y `diasVistos` suena
general cuando sólo cubre los días que se van a borrar. Renombralos a
`firmasVistas` y `diasYaMarcadosParaBorrar`. Es estético y por eso se hace
acá, aprovechando que el archivo ya se toca.

- [ ] **Paso 3: Verificar que compila y que la suite sigue verde**

```bash
npx tsc --noEmit && npx vitest run
```

Esperado: sin errores de tipos, toda la suite PASA.

- [ ] **Paso 4: Verificar que no cambió nada en la base**

```bash
node --env-file=.env.local -e "
const {createClient}=require('@supabase/supabase-js');
const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
(async()=>{
  const {count}=await s.from('fichadas').select('*',{count:'exact',head:true});
  const {data}=await s.from('fichadas').select('empleado_id,fecha,hora_entrada,hora_salida').order('fecha',{ascending:false}).limit(50);
  console.log('total fichadas:',count);
  console.log(JSON.stringify(data));
})();
" > "$TEMP/fichadas-despues.json"
diff "$TEMP/fichadas-antes.json" "$TEMP/fichadas-despues.json" && echo "IDÉNTICO"
```

Esperado: `IDÉNTICO`. Este refactor no corre ningún import, así que cualquier
diferencia es que algo más tocó la base — mirá `git status` antes de sacar
conclusiones, puede ser otra sesión.

- [ ] **Paso 5: Commit**

```bash
git add app/api/rrhh/fichadas/import/confirm/route.ts
git commit -m "refactor(rrhh): el import de Excel pasa por la capa de alta compartida

El route baja de 233 líneas a la mitad y deja de tener lógica propia: parsea
el archivo y delega. El comportamiento no cambia —protegerCorregidos va en
false, que es lo que hace hoy—, y a partir de acá lo que mejora en el alta
mejora para los dos caminos.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Lo que cambió respecto del bloque de arriba, al construirlo

**El bloque de arriba tiene un error de diseño: hacía pasar el modo "separado"
por la reconciliación de marcas** ("se arman tokens de a dos"). Eso está mal, y
la consecuencia se vio recién al correrlo.

`reconciliarTokens` existe para **inferir** qué marca es entrada y cuál salida
a partir de una secuencia cruda. En el modo separado el emparejamiento **ya
viene dado**: el archivo tiene una columna de entrada y otra de salida. Pasarlo
por ahí tira información que el archivo entregó, y produjo dos regresiones
medidas:

- una fila con entrada y sin salida se cerraba con la entrada de **otra fila**
  si caía entre 2 y 14 horas después — algo que el archivo nunca dijo;
- una salida a ≤5 minutos de la entrada se descartaba como "marcación
  fantasma". Ese filtro tiene sentido sobre marcas crudas del reloj, no sobre
  dos columnas que ya dicen cuál es cuál.

**La forma correcta** es una unión discriminada, `LoteAAplicar` en `decidir.ts`:

```ts
| { tipo: "marcas"; empleados: DiasDeEmpleado[] }   // Lenox y el Excel combinado
| { tipo: "turnos"; turnos: TurnoNuevo[] }          // el Excel separado
```

Así el contrato se lee en la firma y no en un flag suelto. La vía `turnos` usa
`turnosYaEmparejados`, que no reconcilia nada. **Desde la bifurcación todo es
común**: dedup, día corregido, liquidación cerrada, aviso de divergencia,
borrado, reinserción y rango de recálculo.

El route quedó en **182 líneas** (eran 233) y conserva sus mensajes propios.

**Las tres diferencias de comportamiento que quedan son buscadas:** sólo se
encadena la fichada abierta del día anterior al primer día del archivo (las más
viejas van al pendiente agregado); los avisos de reconciliación salen después
de los errores de parseo en vez de intercalados; e `insertados` no cuenta los
turnos de días dentro de una liquidación cerrada, que ahora también frena al
Excel.

---

## Tarea 9: Los tres verbos marcan el día como corregido

**Requiere la Tarea 2 corrida.**

**Archivos:**
- Modificar: `app/api/rrhh/fichadas/route.ts` (el `POST`)
- Modificar: `app/api/rrhh/fichadas/[id]/route.ts` (el `PUT` y el `DELETE`)
- Crear: `lib/rrhh/fichadas/marcarDia.ts`

- [ ] **Paso 1: Escribir el helper**

`lib/rrhh/fichadas/marcarDia.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Deja anotado que una persona tocó este (empleado, día), para que la
 * sincronización con Lenox no se lo pise mañana.
 *
 * Lo llaman los tres verbos que significan eso: el alta manual, la edición y
 * el borrado. El borrado es el que obliga a que esto exista como tabla aparte
 * y no como un valor de `origen`: cuando alguien borra una fichada importada
 * —una marca fantasma que el filtro de 5 minutos no agarró, por ejemplo—, la
 * fila que probaría que alguien la tocó ya no está.
 *
 * `upsert` y no `insert`: tocar el mismo día dos veces es lo normal.
 *
 * No lanza. Es una protección, no la operación: que no se pueda anotar no
 * puede hacer fallar la edición que sí funcionó. Lo que sí hace es dejarlo en
 * el log, porque un día sin anotar es un día que el cron va a pisar.
 */
export async function marcarDiaCorregido(
  supabase: SupabaseClient,
  empleadoId: string,
  fecha: string, // "YYYY-MM-DD"
  usuarioId: string,
  accion: "creada" | "editada" | "borrada"
): Promise<void> {
  try {
    const { error } = await supabase
      .from("rrhh_dias_corregidos")
      .upsert(
        { empleado_id: empleadoId, fecha, usuario_id: usuarioId, accion },
        { onConflict: "empleado_id,fecha" }
      );
    if (error) throw new Error(error.message);
  } catch (e) {
    console.error("No se pudo marcar el día como corregido:", empleadoId, fecha, e);
  }
}
```

- [ ] **Paso 2: Engancharlo en el `POST`**

En `app/api/rrhh/fichadas/route.ts`, agregar el import:

```ts
import { marcarDiaCorregido } from "@/lib/rrhh/fichadas/marcarDia";
```

Y en el `POST`, justo después del `if (error) return ...` del insert y antes
del `recalcularEmpleadoPeriodo`:

```ts
  const { data: { user } } = await supabase.auth.getUser();
  await marcarDiaCorregido(supabase, employeeId, fecha, user!.id, "creada");
```

- [ ] **Paso 3: Engancharlo en el `PUT` y el `DELETE`**

En `app/api/rrhh/fichadas/[id]/route.ts`, agregar el mismo import, y en cada
uno de los dos handlers, después del `if (error) return ...` y antes del
`recalcularEmpleadoPeriodo`:

```ts
  const { data: { user } } = await supabase.auth.getUser();
  await marcarDiaCorregido(supabase, fichada.empleado_id, fichada.fecha, user!.id, "editada");
```

En el `DELETE`, la acción es `"borrada"`.

Ojo con el `PUT`: si el cuerpo trae `fecha` o `employeeId`, la fichada se
movió de día o de empleado. Hay que marcar **los dos**, el viejo y el nuevo.
Para eso, antes del `update`, leer la fila como está:

```ts
  const { data: previa } = await supabase
    .from("fichadas").select("empleado_id, fecha").eq("id", id).maybeSingle();
```

y después del update, además del marcado de arriba:

```ts
  if (previa && (previa.empleado_id !== fichada.empleado_id || previa.fecha !== fichada.fecha)) {
    await marcarDiaCorregido(supabase, previa.empleado_id, previa.fecha, user!.id, "editada");
  }
```

- [ ] **Paso 3 bis: Registrar la tabla en el guard de borrado de usuarios**

En `app/api/administracion/usuarios/[id]/route.ts`, el arreglo
`TABLAS_CON_HISTORIAL` (línea 44) lista las tablas que referencian
`usuarios.id` **sin cascade**, para devolver un 409 limpio en vez de que el
`delete` reviente con un `23503` y termine en un 500 con el mensaje crudo de
Postgres. `rrhh_dias_corregidos.usuario_id` es exactamente ese caso. Agregar:

```ts
  { tabla: "rrhh_dias_corregidos", columna: "usuario_id" },
```

Es el mismo tipo de olvido silencioso que el CLAUDE.md describe para
`auditar()`: lo escribe la aplicación, no hay nada que avise, y no se nota
hasta que alguien borra un usuario.

- [ ] **Paso 4: Verificar de punta a punta contra la base**

```bash
node --env-file=.env.local -e "
const {createClient}=require('@supabase/supabase-js');
const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
(async()=>{
  const {data:e}=await s.from('empleados').select('id,legajo').limit(1).single();
  const {data:u}=await s.from('usuarios').select('id').limit(1).single();
  const r=await s.from('rrhh_dias_corregidos')
    .upsert({empleado_id:e.id,fecha:'2026-01-02',usuario_id:u.id,accion:'editada'},{onConflict:'empleado_id,fecha'})
    .select('id').single();
  console.log('upsert:', r.error ? 'FALLA — '+r.error.message : 'ok');
  const r2=await s.from('rrhh_dias_corregidos')
    .upsert({empleado_id:e.id,fecha:'2026-01-02',usuario_id:u.id,accion:'borrada'},{onConflict:'empleado_id,fecha'})
    .select('id').single();
  console.log('upsert repetido (no duplica):', r2.data?.id===r.data?.id ? 'ok' : 'FALLA');
  await s.from('rrhh_dias_corregidos').delete().eq('id',r.data.id);
})();
"
```

Esperado: `upsert: ok` y `upsert repetido (no duplica): ok`. Esto ejercita el
`onConflict` real contra el índice único, que es donde fallaría si la
migración quedó distinta de lo escrito.

- [ ] **Paso 5: Verificar que compila**

```bash
npx tsc --noEmit
```

- [ ] **Paso 6: Commit**

```bash
git add lib/rrhh/fichadas/marcarDia.ts app/api/rrhh/fichadas/route.ts "app/api/rrhh/fichadas/[id]/route.ts" "app/api/administracion/usuarios/[id]/route.ts"
git commit -m "feat(rrhh): tocar una fichada a mano marca el día como corregido

Los tres verbos que significan 'esto lo decidió una persona' —alta manual,
edición y borrado— anotan el (empleado, día) para que la sincronización con
Lenox no lo pise. El borrado es el que obliga a que esto sea una tabla y no
un valor de origen: al borrar, la fila que lo probaría ya no está.

El PUT que mueve una fichada de día o de empleado marca los dos.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Tarea 10: La orquestación y el cotejo de empleados

**Archivos:**
- Crear: `lib/rrhh/lenox/sincronizar.ts`

- [ ] **Paso 1: Escribir el módulo**

`lib/rrhh/lenox/sincronizar.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { traerMarcaciones, traerEmpleados } from "./cliente";
import { agruparPorLegajo } from "./agrupar";
import { aplicarDias, type DiasDeEmpleado } from "../fichadas/aplicar";
import type { DiaMarcacionesTokens } from "../excelImport";
import { addUtcDays } from "../dates";
import { traerTodo } from "@/lib/core/paginado";

export interface ResumenSincronizacion {
  desde: string;
  hasta: string;
  marcacionesTraidas: number;
  insertados: number;
  reemplazados: number;
  salteados: number;
  avisos: string[];
  batchId: string;
}

function fechaStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function ddmm(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Trae las marcaciones de Lenox para un rango y las aplica.
 *
 * El cotejo del padrón va adentro de la misma corrida y no en una pantalla
 * aparte: adelanta el aviso. Hoy un alta que no se cargó aparece como
 * `legajo "PC_241" no encontrado` recién cuando ya falló la carga; así
 * aparece antes y con nombre y apellido. No crea ni borra empleados — los
 * catálogos del núcleo se leen, no se rehacen desde un módulo.
 */
export async function sincronizarMarcaciones(
  admin: SupabaseClient,
  desde: Date,
  hasta: Date,
  usuarioId: string | null
): Promise<ResumenSincronizacion> {
  const marcaciones = await traerMarcaciones(desde, hasta);
  const { porLegajo, descartadas } = agruparPorLegajo(marcaciones, desde, hasta);

  const { data: empleadosData } = await admin.from("empleados").select("id, legajo, nombre, apellido, activo");
  const legajoToId = new Map((empleadosData ?? []).map((e) => [String(e.legajo).trim(), e.id]));

  const avisosPrevios: string[] = [];

  // Lo que la API mandó y no se pudo leer. Nunca se descarta en silencio: si
  // un día volviera basura, sin esto la sincronización cargaría nada y
  // reportaría éxito — la divergencia que no avisa, que es la peor.
  // `fueraDeRango` es el que más importa de los cuatro, por contraintuitivo:
  // un desfase de huso o un filtro de fechas que la API interpreta distinto
  // deja TODAS las marcas afuera, y sin contarlas esto cargaría cero y
  // reportaría éxito.
  const { sinLegajo, fechaIlegible, horaIlegible, fueraDeRango } = descartadas;
  const perdidas = sinLegajo + fechaIlegible + horaIlegible + fueraDeRango;
  if (perdidas > 0) {
    avisosPrevios.push(
      `Lenox devolvió ${perdidas} marcaciones que no se usaron, de ${marcaciones.length} en total ` +
        `(${sinLegajo} sin legajo, ${fechaIlegible} con fecha ilegible, ` +
        `${horaIlegible} con hora ilegible, ${fueraDeRango} fuera del rango pedido)`
    );
  }

  const empleados: DiasDeEmpleado[] = [];
  const yaIncluidos = new Set<string>();
  for (const [legajo, dias] of porLegajo) {
    const empleadoId = legajoToId.get(legajo);
    if (!empleadoId) {
      // No se enlaza al que se le parece: queda afuera y se informa.
      avisosPrevios.push(`Legajo ${legajo}: Lenox tiene marcaciones pero el legajo no existe en el SdG`);
      continue;
    }
    empleados.push({ empleadoId, legajo, dias });
    yaIncluidos.add(empleadoId);
  }

  // Los que NO tienen ninguna marcación en el rango pero sí una fichada
  // abierta de antes.
  //
  // El agrupador sólo devuelve legajos que aparecen en la respuesta de la
  // API, y ahí está la diferencia con el Excel: el reporte del Excel trae una
  // fila por día para TODOS, así que un turno que quedó sin salida se cierra
  // —o al menos se avisa— aunque la persona no haya vuelto a fichar. Por la
  // API, si alguien dejó una fichada abierta y después se tomó dos semanas de
  // vacaciones, no aparece en ninguna ventana de 7 días y esa fichada queda
  // abierta para siempre, sin que nada avise.
  //
  // Se resuelve sumando sólo a los que tienen una fichada abierta anterior al
  // rango, con días vacíos. Es equivalente a recorrer los 68 empleados —para
  // alguien sin marcas y sin fichada abierta, reconciliar días vacíos no
  // produce nada— pero cuesta una consulta en vez de 68.
  //
  // Va con traerTodo aunque al 07/10/2026 sean 54 filas de 23 empleados: cada
  // aviso de "turno sin marcación de salida" deja una, y son del orden de 50
  // a 80 por lote. PostgREST corta en 1000 y no avisa, y acá un corte mudo se
  // vería como "esa fichada abierta no existe" en vez de como un error.
  const abiertas = await traerTodo<{ empleado_id: string; empleados: { legajo: string } | null }>((d, h) =>
    admin.from("fichadas").select("empleado_id, empleados(legajo)")
      .is("hora_salida", null).lt("fecha", fechaStr(desde)).order("id").range(d, h)
  );
  for (const f of abiertas) {
    if (yaIncluidos.has(f.empleado_id)) continue;
    yaIncluidos.add(f.empleado_id);
    const dias: DiaMarcacionesTokens[] = [];
    for (let d = desde; d.getTime() <= hasta.getTime(); d = addUtcDays(d, 1)) {
      dias.push({ fecha: d, tokens: [] });
    }
    empleados.push({ empleadoId: f.empleado_id, legajo: f.empleados?.legajo ?? "?", dias });
  }

  const { data: batch, error: batchErr } = await admin
    .from("rrhh_import_batches")
    .insert({ nombre_archivo: `Lenox API · ${ddmm(desde)} → ${ddmm(hasta)}`, usuario_id: usuarioId })
    .select("id")
    .single();
  if (batchErr) throw new Error(batchErr.message);

  // `aplicarDias` se llama UNA sola vez con el rango entero, no una por
  // ventana de 7 días. El partido en ventanas es un detalle del cliente HTTP
  // y muere ahí: `traerMarcaciones` devuelve las filas de todo el rango.
  // Llamarlo por ventana repetiría el aviso agregado de fichadas abiertas
  // viejas —cada una con su propio "antes del" y su propia lista— y además
  // rompería el encadenamiento entre ventanas.
  const resultado = await aplicarDias(admin, empleados, {
    batchId: batch.id,
    protegerCorregidos: true,
  });

  // `pendientes` son fichadas abiertas viejas que alguien tiene que cerrar a
  // mano. Es información, no un fallo: no cuenta como error de la corrida.

  const avisos = [...avisosPrevios, ...resultado.avisos, ...(await cotejarPadron(admin, empleadosData ?? []))];
  const detalle = [...avisos, ...resultado.pendientes];

  await admin
    .from("rrhh_import_batches")
    .update({
      cantidad_registros: resultado.insertados,
      // `pendientes` va al detalle pero NO al conteo de errores: un número de
      // errores que incluye lo que no es un error es un número que nadie mira.
      cantidad_errores: avisos.length,
      log_detalle: detalle.length ? detalle.join("\n") : null,
    })
    .eq("id", batch.id);

  return {
    desde: fechaStr(desde),
    hasta: fechaStr(hasta),
    marcacionesTraidas: marcaciones.length,
    insertados: resultado.insertados,
    reemplazados: resultado.reemplazados,
    salteados: resultado.salteados.length,
    avisos,
    batchId: batch.id,
  };
}

/** Las diferencias entre el padrón de Lenox y el del SdG. Informa; no toca nada. */
async function cotejarPadron(
  _admin: SupabaseClient,
  delSdG: { legajo: string; nombre: string; apellido: string; activo: boolean }[]
): Promise<string[]> {
  let deLenox;
  try {
    deLenox = await traerEmpleados();
  } catch (e) {
    // El cotejo es accesorio: que falle no puede voltear una sincronización
    // de marcaciones que sí funcionó.
    return [`No se pudo cotejar el padrón con Lenox: ${e instanceof Error ? e.message : String(e)}`];
  }

  const avisos: string[] = [];
  const enSdG = new Map(delSdG.map((e) => [String(e.legajo).trim(), e]));

  for (const e of deLenox) {
    const legajo = String(e.legajo ?? "").trim();
    if (!legajo) continue;
    const local = enSdG.get(legajo);
    if (!local) {
      if (!e.fechaBaja) avisos.push(`Alta sin cargar: ${legajo} — ${e.nombre} ${e.apellido} está en Lenox y no en el SdG`);
      continue;
    }
    if (e.fechaBaja && local.activo) {
      avisos.push(`Baja sin cargar: ${legajo} — ${local.nombre} ${local.apellido} figura de baja en Lenox el ${e.fechaBaja} y activo en el SdG`);
    }
  }

  const enLenox = new Set(deLenox.map((e) => String(e.legajo ?? "").trim()));
  for (const e of delSdG) {
    const legajo = String(e.legajo).trim();
    if (e.activo && !enLenox.has(legajo)) {
      avisos.push(`Sin reloj: ${legajo} — ${e.nombre} ${e.apellido} está activo en el SdG y no existe en Lenox`);
    }
  }

  return avisos;
}
```

- [ ] **Paso 2: Verificar que compila**

```bash
npx tsc --noEmit
```

- [ ] **Paso 3: Correrlo de verdad contra un día, en seco**

Con un día que **no** esté liquidado ni corregido, y mirando el total antes y
después:

```bash
node --env-file=.env.local -e "
const {createClient}=require('@supabase/supabase-js');
const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
(async()=>{
  const {count}=await s.from('fichadas').select('*',{count:'exact',head:true});
  console.log('fichadas antes:',count);
})();
"
npx tsx -e "
import { createClient } from '@supabase/supabase-js';
import { sincronizarMarcaciones } from './lib/rrhh/lenox/sincronizar';
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const r = await sincronizarMarcaciones(admin, new Date('2026-10-01'), new Date('2026-10-01'), null);
console.log(JSON.stringify(r, null, 1));
"
```

Esperado: un resumen con `marcacionesTraidas` > 0 e `insertados` > 0. Si
`npx tsx` no está disponible, correrlo como una ruta temporal o con
`npx vite-node`. **Esto escribe en la base de producción**: elegí un día que
ya esté cargado para que el reemplazo por día lo deje igual, y compará las
fichadas de ese día con lo que había.

- [ ] **Paso 4: Comparar contra el Excel del mismo día**

Es la prueba que cierra esto. Para un día que ya se había importado por Excel,
las fichadas resultantes tienen que ser las mismas:

```bash
node --env-file=.env.local -e "
const {createClient}=require('@supabase/supabase-js');
const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
(async()=>{
  const {data}=await s.from('fichadas')
    .select('empleados(legajo),hora_entrada,hora_salida')
    .eq('fecha','2026-10-01').order('hora_entrada');
  console.log(data.length,'fichadas');
  for(const f of data) console.log(f.empleados.legajo, f.hora_entrada, f.hora_salida);
})();
"
```

Esperado: la misma cantidad y las mismas horas que antes de la sincronización.
Si hay diferencias, **no sigas**: anotalas y revisá el agrupador antes que
nada — es el candidato número uno.

- [ ] **Paso 5: Commit**

```bash
git add lib/rrhh/lenox/sincronizar.ts
git commit -m "feat(rrhh): la sincronización de marcaciones con Lenox

Trae, agrupa, aplica y coteja el padrón, todo en una corrida. El cotejo va
adentro y no en una pantalla aparte porque adelanta el aviso: hoy un alta sin
cargar aparece como 'legajo no encontrado' recién cuando ya falló la carga.
No crea ni borra empleados.

Un legajo de Lenox que no existe en el SdG queda afuera y se informa: enlazar
al que se le parece es peor que dejar en null.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Tarea 11: Las dos rutas y el cron

**Archivos:**
- Crear: `app/api/cron/rrhh-lenox-sync/route.ts`
- Crear: `app/api/rrhh/fichadas/lenox/sincronizar/route.ts`
- Modificar: `vercel.json`

- [ ] **Paso 1: Escribir el cron**

`app/api/cron/rrhh-lenox-sync/route.ts`:

```ts
import { NextResponse } from "next/server";
import { revisarElSecreto } from "@/lib/core/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { registrarSincronizacion } from "@/lib/core/sincronizaciones";
import { hayCredencialesLenox } from "@/lib/rrhh/lenox/cliente";
import { sincronizarMarcaciones } from "@/lib/rrhh/lenox/sincronizar";
import { addUtcDays, utcDateOnlyFrom } from "@/lib/rrhh/dates";

export const maxDuration = 300;

/**
 * Trae una vez por día las marcaciones del reloj.
 *
 * A las 10:30 UTC —7:30 de acá—, que no es arbitrario: después de que cierre
 * el turno noche (termina alrededor de las 4) y antes de que alguien abra la
 * pantalla. Es además el hueco que queda entre los ocho crons que ya hay,
 * amontonados entre las 6 y las 9:30 UTC.
 *
 * La ventana es de 7 días, que es también el tope por pedido de la API: una
 * sola llamada. El riesgo asumido está en el spec — si nadie mira durante más
 * de una semana, lo más viejo que 7 días hay que traerlo con el botón.
 *
 * Falla cerrado: sin `CRON_SECRET` devuelve 503 en vez de quedar abierto a
 * cualquiera que conozca la URL.
 */
export async function GET(request: Request) {
  const rechazo = revisarElSecreto(request);
  if (rechazo) return rechazo;

  // Sin la clave no hay nada que traer, y no es un error.
  if (!hayCredencialesLenox()) {
    return NextResponse.json({ omitido: "Lenox no está configurado" });
  }

  const hasta = utcDateOnlyFrom(new Date());
  const desde = addUtcDays(hasta, -6); // 7 días contando hoy

  try {
    const resumen = await sincronizarMarcaciones(createAdminClient(), desde, hasta, null);
    await registrarSincronizacion({
      modulo: "rrhh",
      recurso: "lenox-marcaciones",
      ok: true,
      filas: resumen.insertados,
    });
    return NextResponse.json(resumen);
  } catch (e) {
    // Lo que dijo Lenox, sin traducir: una fecha vieja sin explicación es
    // justo lo que hace que nadie sepa si está mirando datos al día.
    const error = e instanceof Error ? e.message : String(e);
    await registrarSincronizacion({
      modulo: "rrhh",
      recurso: "lenox-marcaciones",
      ok: false,
      error,
    });
    return NextResponse.json({ error }, { status: 500 });
  }
}
```

- [ ] **Paso 2: Escribir la ruta del botón**

`app/api/rrhh/fichadas/lenox/sincronizar/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puede_editar_check } from "@/lib/rrhh/route-utils";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { validar, errorDeValidacion } from "@/lib/core/validar";
import { registrarSincronizacion } from "@/lib/core/sincronizaciones";
import { hayCredencialesLenox } from "@/lib/rrhh/lenox/cliente";
import { sincronizarMarcaciones } from "@/lib/rrhh/lenox/sincronizar";
import { toUtcDateOnly } from "@/lib/rrhh/dates";

export const maxDuration = 300;

const esquema = z.object({
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha va como AAAA-MM-DD"),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha va como AAAA-MM-DD"),
});

function aFecha(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return toUtcDateOnly(y, m - 1, d);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;
  const { data: { user } } = await supabase.auth.getUser();

  if (!hayCredencialesLenox()) {
    return NextResponse.json({ error: "Lenox no está configurado (falta LENOX_API_KEY)" }, { status: 503 });
  }

  const resultado = validar(esquema, await cuerpoJson(request));
  if (!resultado.ok) return errorDeValidacion(resultado.problemas);

  const desde = aFecha(resultado.datos.desde);
  const hasta = aFecha(resultado.datos.hasta);
  if (hasta.getTime() < desde.getTime()) {
    return NextResponse.json({ error: "La fecha de fin es anterior a la de inicio" }, { status: 400 });
  }
  const dias = (hasta.getTime() - desde.getTime()) / 86_400_000 + 1;
  if (dias > 62) {
    return NextResponse.json({ error: "El rango no puede superar los 62 días" }, { status: 400 });
  }

  try {
    const resumen = await sincronizarMarcaciones(createAdminClient(), desde, hasta, user!.id);
    await registrarSincronizacion({ modulo: "rrhh", recurso: "lenox-marcaciones", ok: true, filas: resumen.insertados });
    return NextResponse.json(resumen);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await registrarSincronizacion({ modulo: "rrhh", recurso: "lenox-marcaciones", ok: false, error });
    return NextResponse.json({ error }, { status: 500 });
  }
}
```

La forma de `Resultado<T>` está verificada contra `lib/core/validar.ts:40`:
`{ ok: true; datos: T } | { ok: false; problemas: string[] }`.

- [ ] **Paso 3: Agregar el cron a `vercel.json`**

En el array `crons`, después del último:

```json
    {
      "path": "/api/cron/rrhh-lenox-sync",
      "schedule": "30 10 * * *"
    }
```

- [ ] **Paso 4: Verificar que compila y construye**

```bash
npx tsc --noEmit && npm run build
```

Esperado: build OK. **Si hay un `npm run dev` levantado, pararlo antes** — un
`next build` con el dev server corriendo deja la app en 500.

- [ ] **Paso 5: Commit**

```bash
git add app/api/cron/rrhh-lenox-sync/route.ts app/api/rrhh/fichadas/lenox/sincronizar/route.ts vercel.json
git commit -m "feat(rrhh): el cron diario de marcaciones y la ruta del botón

El cron a las 10:30 UTC (7:30 de acá): después de que cierre el turno noche y
antes de que alguien abra la pantalla, en el hueco que queda entre los ocho
crons que ya había. Ventana de 7 días, que es el tope por pedido de la API:
una sola llamada.

Sin LENOX_API_KEY devuelve omitido y no error, como calidad-sync con Odoo.
Las dos rutas anotan la corrida en sincronizaciones, también cuando falla.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Tarea 12: La pantalla

**Archivos:**
- Modificar: `app/(app)/rrhh/fichadas/page.tsx`
- Modificar: `app/(app)/rrhh/fichadas/FichadasClient.tsx`

- [ ] **Paso 1: Leer cómo lo resuelve una pantalla que ya lo hace**

```bash
cat "app/(app)/calidad/envases/TraerDeLaPlanilla.tsx"
cat "app/(app)/calidad/envases/page.tsx"
```

Seguí ese patrón: el `page.tsx` server-side llama a `ultimaSincronizacionDe` y
le pasa el resultado al cliente.

- [ ] **Paso 2: Pasar la última sincronización desde el `page.tsx`**

En `app/(app)/rrhh/fichadas/page.tsx`, agregar:

```tsx
import { ultimaSincronizacionDe } from "@/lib/core/sincronizaciones";
```

y dentro del componente, antes del `return`:

```tsx
  const ultimaSync = await ultimaSincronizacionDe(supabase, "rrhh", "lenox-marcaciones");
```

pasándoselo al cliente como prop `ultimaSync`.

- [ ] **Paso 3: Agregar el bloque de Lenox en `FichadasClient.tsx`**

Arriba del bloque de import de Excel. Primero, la prop nueva en la firma del
componente:

```tsx
import type { UltimaSync } from "@/lib/core/sincronizaciones";

export default function FichadasClient({ empleados, fichadasIniciales, ultimaSync }: {
  empleados: any[];
  fichadasIniciales: any[];
  ultimaSync: UltimaSync | null;
}) {
```

El estado:

```tsx
  const hoy = new Date().toISOString().slice(0, 10);
  const hace7 = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
  const [rango, setRango] = useState({ desde: hace7, hasta: hoy });
  const [sincronizando, setSincronizando] = useState(false);
  const [resumenSync, setResumenSync] = useState<ResumenSync | null>(null);
  const [errorSync, setErrorSync] = useState("");
```

con el tipo:

```tsx
interface ResumenSync {
  desde: string;
  hasta: string;
  marcacionesTraidas: number;
  insertados: number;
  reemplazados: number;
  salteados: number;
  avisos: string[];
}
```

y el handler:

```tsx
  async function sincronizarConLenox() {
    const ok = await confirmar({
      title: "Traer de Lenox",
      message: `Se van a traer las marcaciones del ${rango.desde} al ${rango.hasta}. Los días corregidos a mano y los de una liquidación cerrada no se tocan. ¿Confirmás?`,
      confirmText: "Traer",
    });
    if (!ok) return;
    setSincronizando(true);
    setErrorSync("");
    setResumenSync(null);
    const res = await fetch("/api/rrhh/fichadas/lenox/sincronizar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rango),
    });
    const data = await res.json();
    setSincronizando(false);
    if (!res.ok) {
      // Lo que dijo Lenox, sin traducir: es la diferencia entre un
      // diagnóstico y un cartel genérico.
      setErrorSync(data.error ?? "No se pudo sincronizar");
      return;
    }
    setResumenSync(data);
    router.refresh();
    fetch("/api/rrhh/fichadas").then((r) => r.json()).then(setFichadas).catch(() => {});
  }
```

Y el JSX, arriba del bloque de import:

```tsx
<section className="rounded border border-gray-200 p-4">
  <div className="flex items-center justify-between gap-4">
    <h2 className="font-medium">Traer de Lenox</h2>
    {ultimaSync ? (
      <span className={`text-sm ${ultimaSync.ok ? "text-gray-500" : "text-red-600"}`}>
        {ultimaSync.ok
          ? `Actualizado ${new Date(ultimaSync.created_at).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}`
          : `Falló ${new Date(ultimaSync.created_at).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}: ${ultimaSync.error}`}
      </span>
    ) : (
      <span className="text-sm text-gray-500">Sin sincronizar todavía</span>
    )}
  </div>

  <div className="mt-3 flex flex-wrap items-end gap-3">
    <label className="text-sm">
      Desde
      <input type="date" value={rango.desde} max={rango.hasta}
        onChange={(e) => setRango((r) => ({ ...r, desde: e.target.value }))}
        className="ml-2 rounded border border-gray-300 px-2 py-1" />
    </label>
    <label className="text-sm">
      Hasta
      <input type="date" value={rango.hasta} min={rango.desde}
        onChange={(e) => setRango((r) => ({ ...r, hasta: e.target.value }))}
        className="ml-2 rounded border border-gray-300 px-2 py-1" />
    </label>
    <button type="button" onClick={sincronizarConLenox} disabled={sincronizando}
      className="rounded bg-blue-600 px-4 py-1.5 text-white disabled:opacity-50">
      {sincronizando ? "Trayendo…" : "Traer de Lenox"}
    </button>
  </div>

  {errorSync && <p className="mt-3 text-sm text-red-600">{errorSync}</p>}

  {resumenSync && (
    <div className="mt-3 text-sm">
      <p>
        {resumenSync.marcacionesTraidas} marcaciones del {resumenSync.desde} al {resumenSync.hasta}:{" "}
        <strong>{resumenSync.insertados}</strong> cargadas,{" "}
        {resumenSync.reemplazados} reemplazadas,{" "}
        {resumenSync.salteados} días sin tocar.
      </p>
      {resumenSync.avisos.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-amber-700">
            {resumenSync.avisos.length} avisos
          </summary>
          <ul className="mt-1 max-h-64 list-disc overflow-y-auto pl-5 text-gray-700">
            {resumenSync.avisos.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </details>
      )}
    </div>
  )}
</section>
```

Las clases son las que usa el resto de la pantalla — si `FichadasClient.tsx`
usa otras, seguí las de ahí en vez de éstas.

- [ ] **Paso 4: Plegar el import de Excel**

Envolver el bloque existente de import en un `<details>`:

```tsx
  <details className="mt-6">
    <summary className="cursor-pointer text-sm text-gray-600">
      Importar desde un archivo (respaldo)
    </summary>
    {/* el bloque de import tal como estaba */}
  </details>
```

- [ ] **Paso 5: Revisar que no se haya colado un `<select>` nativo**

```bash
grep -n "<select" "app/(app)/rrhh/fichadas/FichadasClient.tsx"
```

Esperado: nada. Si agregaste un desplegable, va con `<Select>` de
`components/Select.tsx`. Escribir el nativo no rompe nada, y ése es el
problema: esa pantalla queda sin buscador y nadie se entera.

- [ ] **Paso 6: Verificar**

```bash
npx tsc --noEmit && npm run build
```

- [ ] **Paso 7: Commit**

```bash
git add "app/(app)/rrhh/fichadas/page.tsx" "app/(app)/rrhh/fichadas/FichadasClient.tsx"
git commit -m "feat(rrhh): el botón de traer de Lenox, y el Excel pasa a respaldo

Arriba el cartel de última sincronización —que dice también si falló, con lo
que contestó Lenox— y el botón con rango de fechas. El import de archivo baja
a un <details>: sigue entero, pero deja de ser el camino principal.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Tarea 13: Documentación y verificación final

**Archivos:**
- Modificar: `docs/VARIABLES-VERCEL.md`
- Modificar: `docs/RRHH-ACTUALIZACION.md`
- Modificar: `CLAUDE.md`

- [ ] **Paso 1: Documentar la variable**

En `docs/VARIABLES-VERCEL.md`, agregar `LENOX_API_KEY` siguiendo el formato de
las que ya están: qué es, dónde se saca (se activa desde la plataforma de
Lenox, sección API), y que va en el header `LenoxBusinessAPI-Key`.

- [ ] **Paso 2: Documentar el cambio en RRHH**

En `docs/RRHH-ACTUALIZACION.md`, agregar una sección con: que las marcaciones
entran por API desde el 07/10/2026, que el Excel queda de respaldo, las dos
protecciones y por qué la unidad es el día, y la ventana de 7 días como riesgo
asumido.

- [ ] **Paso 3: Actualizar el CLAUDE.md**

En la tabla de documentos por módulo, agregar el spec de esta tarea en la fila
de RRHH. Y en la sección de las planillas, una línea: RRHH ahora tiene además
una integración por API con el reloj, que no es una planilla y donde **manda
Lenox** (el SdG lee, nunca escribe del otro lado).

- [ ] **Paso 4: Correr las cuatro verificaciones**

```bash
npm test
npx tsc --noEmit
npm run build
node scripts/revisar-arbol-commiteado.mjs
```

Las cuatro tienen que pasar. **La última es la que importa acá**, porque esta
tarea crea siete archivos nuevos: resuelve los imports del árbol de git contra
sí mismo, y es lo que atrapa un archivo que quedó staged y nunca se commiteó
mientras los que lo importan sí viajaron. Eso tiró cuatro deploys seguidos el
14/09/2026.

- [ ] **Paso 5: Commit y push**

```bash
git add docs/VARIABLES-VERCEL.md docs/RRHH-ACTUALIZACION.md CLAUDE.md
git commit -m "docs(rrhh): las marcaciones entran por la API de Lenox

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push
```

- [ ] **Paso 6: Cargar la variable en Vercel y verificar en producción**

Decirle al usuario que cargue `LENOX_API_KEY` en Vercel (Production y
Preview). Después del deploy, verificar que el cron quedó registrado y correr
el botón una vez con un rango de un día, comparando las fichadas de ese día
antes y después.

---

## Lo que queda explícitamente fuera

Está en el spec y vale repetirlo acá para que no se cuele:
`FechaJornada`/`GetDiasTrabajados`, `precioHora`, `GetLicencias`,
`GetVacaciones`, `GetFeriados`, y sacar el import de Excel.
