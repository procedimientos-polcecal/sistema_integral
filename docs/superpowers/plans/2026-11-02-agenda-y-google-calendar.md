# La Agenda del SdG espejada en Google Calendar — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una sección Agenda que ven los catorce usuarios, donde se crea una
reunión o se manda una OT al calendario de Google de cada invitado, y donde el
SdG avisa al instante si alguien borró o movió el evento del otro lado.

**Architecture:** El SdG es el dueño del dato y Google el espejo, como
Producción con su planilla — pero el espejo no se pisa en silencio. Un cliente
de Calendar nuevo en `lib/core/calendar.ts`, hermano de `lib/core/sheets.ts`,
que impersona a cada casilla con la delegación de dominio ya autorizada. La
lógica pura vive en `lib/agenda/`, las pantallas en `app/(app)/agenda`, las
rutas en `app/api/agenda`. La detección de divergencia **no usa `syncToken`**:
cuando Google avisa que algo cambió en un calendario, el SdG relee sus propias
filas futuras de esa casilla y las compara contra lo último que él escribió.

**Tech Stack:** Next.js 16 (App Router), Supabase (Postgres + RLS), TypeScript,
vitest, Tailwind v4. Sin librerías nuevas: el JWT se firma a mano como ya lo
hace `lib/core/google.ts`.

**Spec:** [docs/superpowers/specs/2026-10-30-agenda-y-google-calendar-design.md](../specs/2026-10-30-agenda-y-google-calendar-design.md)

## Lo que ya está hecho y no hay que volver a hacer

Comprobado contra Google el 02/11/2026, antes de este plan:

- La **API de Calendar está habilitada** en el proyecto `mantenimientopp`.
- La **delegación de dominio está autorizada** para el client ID
  `101499089090401417948` con el scope `https://www.googleapis.com/auth/calendar`.
- Las **catorce direcciones son casillas y no alias**: las catorce entregan
  token impersonando.
- Crear, leer, mover y borrar un evento funciona, y el `organizer` resulta la
  casilla impersonada.

## Global Constraints

- **Todo en castellano**: nombres, comentarios, mensajes de pantalla y de commit.
- **Ruta**: `/agenda`. **Carpeta de código**: `lib/agenda`. **Prefijo de
  tablas**: `agenda_`.
- **Zona horaria**: la constante `ZONA_ARGENTINA =
  "America/Argentina/Buenos_Aires"` viaja **explícita en cada evento**. Medido:
  **nueve de los catorce calendarios están en `UTC`**, así que un evento sin
  zona le cae a esas nueve personas tres horas corrido.
- **Duración de una OT en el calendario**: **90 minutos**. **Horas de inicio
  por turno**: `4-12` → `04:00`, `8-16` → `08:00`, `12-20` → `12:00`.
- **Los cinco invitados fijos de una OT**, exactos:
  `nicolaslenzetti@polcecal.com`, `gerencia@polcecal.com`,
  `produccion@polcecal.com`, `mantenimiento@polcecal.com`,
  `soporte.mantenimiento@polcecal.com`.
- **Divergencia son dos cosas y nada más**: borrado y movido (cambió el inicio
  o el fin). Un cambio de título, de lugar, de invitados o **un RSVP no es
  divergencia**.
- **Un evento borrado en Google no desaparece**: devuelve HTTP **200** con
  `status: "cancelled"`. Buscar un 404 no detecta nada.
- **Las migraciones las corre una persona** a mano en el editor SQL de Supabase.
  Un agente las escribe y espera; **no puede correr DDL**.
- **Una policy llama a su función envuelta** —`using ((select auth.uid()))`—
  **salvo cuando depende de una columna de la fila**, que es el caso de
  `agenda_eventos`: ahí el `exists` sobre los invitados va sin envolver, o
  todos verían los eventos del primero.
- **Un desplegable se escribe `<Select>`**, no `<select>`.
- **Una grilla de tres o más columnas lleva breakpoint**: `grid-cols-1
  sm:grid-cols-3`. El ancho útil del teléfono es 343 px.
- **`className="input w-20"` no mide 20**: el ancho va en un `div` que envuelva
  al campo.
- **Un fallo de escritura nunca es un `console.warn`**: se guarda **lo que dijo
  Google sin traducir** y se le dice a quien hizo la acción; si no hay nadie
  —la sincronización, el borrado de espejo— va a la cola con reintento.
- **Nunca `git add -A`**, y **puede haber otra sesión en el mismo árbol**. Se
  commitea con rutas explícitas: `git commit --only <rutas> -F <mensaje>`.
- **`traerTodo()` de `lib/core/paginado.ts`** en cualquier tabla que pueda crecer.
- Commits: conventional en castellano, `feat(agenda): …`, con el cuerpo
  explicando **por qué**.

## Review Focus

Cinco cosas que la spec implica, que ningún test obvio ejercita, y que le van a
morder a una persona de verdad. Cada una tiene su test asignado a la tarea
dueña del código:

1. **La notificación de Google por un cambio que hizo el propio SdG.** Es el
   caso más frecuente de todos: cada vez que la planilla mueve una OT, el SdG
   escribe y Google notifica. Si no se distingue del cambio de una persona,
   cada movimiento alerta a cinco. → Tarea 4 (la función pura) y Tarea 9 (el
   webhook).
2. **Un invitado que acepta o rechaza.** Con cinco invitados por OT, es el
   cambio que más veces va a llegar. Tiene que dar «no es divergencia», igual
   que un cambio de título o de lugar. → Tarea 4.
3. **Un mail de invitado mal escrito.** Google rechaza el evento **entero** con
   un 400 que no nombra cuál; hay que validarlos antes y decir cuál está mal, o
   la reunión no se crea y nadie sabe por qué. → Tarea 4 (la validación) y
   Tarea 5 (el 400 en castellano).
4. **Un fin anterior o igual al inicio.** Google lo acepta y deja un evento que
   en el calendario no se ve. Se rechaza en la ruta, en castellano. → Tarea 4 y
   Tarea 5.
5. **Que Google esté caído cuando la planilla borra una OT.** Si el borrado del
   evento falla y la OT se borra igual, el evento queda vivo en cinco
   calendarios sin ninguna fila que lo nombre: nadie puede sacarlo nunca más
   desde el sistema. Esa OT **no se borra en esa corrida** y se reintenta. →
   Tarea 8.

---

### Tarea 1: El caché de tokens, por quién se impersona

El caché de `obtenerToken()` guarda **sólo por juego de scopes**. Con
impersonación eso entrega a un usuario el token de otro, y no falla: escribe en
el calendario equivocado, que es la peor forma de romperse.

**Files:**
- Modify: `lib/core/google.ts`
- Test: `lib/core/google.test.ts`

**Interfaces:**
- Produces: `obtenerToken(scopes: string[], comoQuien?: string): Promise<string>`
  — sin `comoQuien` se comporta exactamente como hoy (los 21 llamadores no se
  tocan). `export const SCOPE_CALENDAR = "https://www.googleapis.com/auth/calendar"`.

- [ ] **Step 1: Escribir los tests que fallan**, en el bloque que ya existe en
  `lib/core/google.test.ts` para el caché:

```ts
it("dos casillas distintas no comparten el token", async () => {
  await obtenerToken([SCOPE_CALENDAR], "a@polcecal.com");
  await obtenerToken([SCOPE_CALENDAR], "b@polcecal.com");
  expect(pedidos).toBe(2);
});

it("la misma casilla reusa el suyo", async () => {
  await obtenerToken([SCOPE_CALENDAR], "a@polcecal.com");
  await obtenerToken([SCOPE_CALENDAR], "a@polcecal.com");
  expect(pedidos).toBe(1);
});

it("impersonar y no impersonar son entradas distintas", async () => {
  await obtenerToken([SCOPE_CALENDAR]);
  await obtenerToken([SCOPE_CALENDAR], "a@polcecal.com");
  expect(pedidos).toBe(2);
});
```

(`pedidos` es el contador del mock de `fetch` que ese archivo ya tiene: una
variable de módulo que `beforeEach` pone en 0. No hace falta agregar nada.)

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run lib/core/google.test.ts`
Expected: FAIL — hoy los tres dan 1 viaje, porque la clave ignora el subject.

- [ ] **Step 3: Agregar `SCOPE_CALENDAR` y el parámetro `comoQuien`**

La clave del caché pasa a incluir a quién se impersona de forma que no se pueda
confundir con un scope (un `\n` entre las dos partes alcanza). Cuando
`comoQuien` viene, el JWT lleva `sub: comoQuien` además de lo que ya lleva.

En el docstring del caché, dejar escrito **por qué** el subject va en la clave:
sin él, a un usuario se le entrega el token de otro y la escritura va al
calendario equivocado sin error.

- [ ] **Step 4: Correr los tests del archivo entero**

Run: `npx vitest run lib/core/google.test.ts`
Expected: PASS, los nuevos y los que ya estaban.

- [ ] **Step 5: Commit**

```bash
git commit --only lib/core/google.ts lib/core/google.test.ts -m "feat(core): el token de Google se cachea tambien por a quien se impersona"
```

---

### Tarea 2: La migración — las cuatro tablas y su RLS

**Esta tarea termina esperando al usuario**: el agente escribe el archivo y
**no puede correr DDL**. Nada de lo que sigue funciona hasta que esté aplicada.

**Files:**
- Create: `supabase/migrations/<marca de tiempo>_agenda_schema.sql`
  (generado con `npm run migracion "agenda schema"`)

**Interfaces:**
- Produces: las tablas `agenda_eventos`, `agenda_invitados`,
  `agenda_divergencias_vistas` y `agenda_canales`, con los nombres de columna
  que usan todas las tareas siguientes.

- [ ] **Step 1: Generar el archivo**

Run: `npm run migracion "agenda schema"`

- [ ] **Step 2: Escribir el encabezado**

Un comentario que diga qué resuelve y las tres cosas que no se deducen del SQL:
que el SdG es el dueño y Google el espejo; que `inicio_escrito`/`fin_escrito`
existen **sólo** para distinguir el eco de las propias escrituras de un cambio
hecho por una persona; y que `divergencia_el` se compara contra
`agenda_divergencias_vistas.divergencia_el`, de modo que una divergencia nueva
vuelve a aparecer aunque la anterior se haya dado por vista.

- [ ] **Step 3: Escribir las tablas**

```sql
create table agenda_eventos (
  id                  uuid primary key default gen_random_uuid(),
  titulo              text not null,
  descripcion         text,
  lugar               text,
  inicio              timestamptz not null,
  fin                 timestamptz not null,
  dueno_id            uuid not null references usuarios(id) on delete cascade,
  casilla             text not null,
  google_event_id     text,
  inicio_escrito      timestamptz,
  fin_escrito         timestamptz,
  divergencia         text check (divergencia in ('borrado', 'movido')),
  divergencia_el      timestamptz,
  google_pendiente    text,
  google_pendiente_el timestamptz,
  -- Algo que una persona tiene que mirar y que NO es un fallo de escritura ni
  -- una divergencia: hoy, que la planilla vació la fecha de ejecución de su OT.
  -- Va en su propia columna a propósito: meterlo en `google_pendiente` haría
  -- que dos diagnósticos distintos se vean iguales, que es justo lo que ese
  -- campo existe para evitar.
  aviso               text,
  ot_id               uuid unique references ordenes_trabajo(id) on delete cascade,
  turno               text check (turno in ('4-12', '8-16', '12-20')),
  created_at          timestamptz not null default now(),
  check (fin > inicio)
);

create index agenda_eventos_dueno_idx on agenda_eventos (dueno_id);
create index agenda_eventos_inicio_idx on agenda_eventos (inicio);
create index agenda_eventos_casilla_idx on agenda_eventos (casilla);

create table agenda_invitados (
  id         uuid primary key default gen_random_uuid(),
  evento_id  uuid not null references agenda_eventos(id) on delete cascade,
  email      text not null,
  usuario_id uuid references usuarios(id) on delete set null,
  unique (evento_id, email)
);

create index agenda_invitados_usuario_idx on agenda_invitados (usuario_id);

create table agenda_divergencias_vistas (
  evento_id      uuid not null references agenda_eventos(id) on delete cascade,
  usuario_id     uuid not null references usuarios(id) on delete cascade,
  divergencia_el timestamptz not null,
  primary key (evento_id, usuario_id)
);

create table agenda_canales (
  id         uuid primary key default gen_random_uuid(),
  casilla    text not null unique,
  canal_id   text not null,
  recurso_id text not null,
  secreto    text not null,
  vence      timestamptz not null,
  created_at timestamptz not null default now()
);
```

El `on delete cascade` de `ot_id` es una red, **no el mecanismo**: el evento de
Google lo borra la aplicación antes (Tarea 8). Dejarlo escrito en un comentario
al lado, porque leer sólo el SQL hace pensar lo contrario.

- [ ] **Step 4: Escribir la RLS**

`agenda_eventos` se ve si sos el dueño **o** si estás invitado. El
`auth.uid()` va envuelto; el `exists` sobre los invitados **no**, porque
depende de la fila — envolverlo le mostraría a cada uno los eventos del
primero, que es el único error de este tema que es un agujero y no una
lentitud. Dejarlo dicho en un comentario encima de la policy.

```sql
alter table agenda_eventos enable row level security;

create policy agenda_eventos_ver on agenda_eventos for select using (
  dueno_id = (select auth.uid())
  or exists (
    select 1 from agenda_invitados i
     where i.evento_id = agenda_eventos.id
       and i.usuario_id = (select auth.uid())
  )
);

create policy agenda_eventos_crear on agenda_eventos for insert
  with check (dueno_id = (select auth.uid()));

create policy agenda_eventos_editar on agenda_eventos for update
  using (dueno_id = (select auth.uid()));

create policy agenda_eventos_borrar on agenda_eventos for delete
  using (dueno_id = (select auth.uid()));
```

`agenda_invitados` se ve si se ve su evento. `agenda_divergencias_vistas`: cada
uno las suyas (insert, update y select con `usuario_id = (select auth.uid())`).
`agenda_canales` **no se expone**: RLS activada y sin ninguna policy, la escribe
sólo el cliente admin.

- [ ] **Step 5: Correr `simular-rls` y pedirle al usuario que aplique**

Run: `node scripts/simular-rls.mjs`
Expected: que no proponga envolver el `exists` de `agenda_eventos_ver`. Si lo
propone, **no hacerle caso** y dejar la excepción anotada donde el script la
lea.

Decirle al usuario que la aplique en el editor SQL de Supabase y **esperar**.

- [ ] **Step 6: Commit**

```bash
git commit --only supabase/migrations/<archivo>.sql -m "feat(agenda): las tablas de la agenda y su RLS"
```

---

### Tarea 3: El cliente de Google Calendar

**Files:**
- Create: `lib/core/calendar.ts`
- Test: `lib/core/calendar.test.ts`

**Interfaces:**
- Consumes: `obtenerToken(scopes, comoQuien)` y `SCOPE_CALENDAR` de la Tarea 1;
  `mensajeDeGoogle()` y `cuentaDeServicio()` de `lib/core/google.ts`.
- Produces:

```ts
export const ZONA_ARGENTINA = "America/Argentina/Buenos_Aires";

/** Fechas como "2026-11-03T08:00:00", sin offset: la zona la pone ZONA_ARGENTINA. */
export interface EventoParaGoogle {
  titulo: string;
  descripcion?: string;
  lugar?: string;
  inicio: string;
  fin: string;
  invitados: string[];
}

/** Lo que Google devuelve, ya recortado a lo que el SdG mira. */
export interface EventoEnGoogle {
  id: string;
  inicio: string;   // con offset: "2026-11-03T08:00:00-03:00"
  fin: string;
  cancelado: boolean;
  titulo?: string;
  invitados: { email: string; respuesta?: string }[];
}

export async function crearEvento(casilla: string, evento: EventoParaGoogle): Promise<EventoEnGoogle>;
export async function leerEvento(casilla: string, idEvento: string): Promise<EventoEnGoogle | null>;
export async function actualizarEvento(casilla: string, idEvento: string, evento: Partial<EventoParaGoogle>): Promise<EventoEnGoogle>;
export async function borrarEvento(casilla: string, idEvento: string): Promise<void>;
export async function abrirCanal(casilla: string, canalId: string, secreto: string, url: string): Promise<{ recursoId: string; vence: string }>;
export async function cerrarCanal(canalId: string, recursoId: string): Promise<void>;
```

- [ ] **Step 1: Escribir los tests que fallan**, con `fetch` mockeado:

```ts
it("manda la zona explícita en inicio y en fin", async () => { /* el body tiene timeZone: ZONA_ARGENTINA en los dos */ });
it("un evento cancelado se lee como cancelado y no como ausente", async () => { /* 200 con status "cancelled" → cancelado: true */ });
it("un 404 se lee como null", async () => { /* leerEvento devuelve null */ });
it("un 403 llega con el mensaje de Google y nombrando la cuenta de servicio", async () => { /* el Error contiene lo que dijo Google */ });
it("corta a los 30 segundos con un mensaje propio", async () => { /* igual que lib/core/sheets.ts */ });
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run lib/core/calendar.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar `lib/core/calendar.ts`**

Calcado de `lib/core/sheets.ts` en lo estructural: el mismo `pedir()` con
`AbortSignal.timeout(30_000)` y el mismo mensaje propio al cortar, y
`mensajeDeGoogle()` para traducir el error. Todas las llamadas van sobre
`https://www.googleapis.com/calendar/v3/calendars/primary/events` con el token
de `casilla`, y **todas llevan `sendUpdates=all`** salvo que se diga lo
contrario — es lo que hace que al invitado le llegue el correo.

El docstring del archivo deja escritas las dos cosas que no se deducen: que la
zona va explícita porque nueve de los catorce calendarios están en UTC, y que
un evento borrado vuelve con 200 y `status: "cancelled"`.

- [ ] **Step 4: Correr los tests**

Run: `npx vitest run lib/core/calendar.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit --only lib/core/calendar.ts lib/core/calendar.test.ts -m "feat(core): el cliente de Google Calendar"
```

---

### Tarea 4: La lógica pura de la agenda

Acá vive todo lo que decide algo, para que se pueda probar sin red ni base. Es
la tarea dueña de cuatro de las cinco cosas del Review Focus.

**Files:**
- Create: `lib/agenda/evento.ts`, `lib/agenda/divergencia.ts`
- Test: `lib/agenda/evento.test.ts`, `lib/agenda/divergencia.test.ts`

**Interfaces:**
- Produces:

```ts
// evento.ts
// `Turno` NO se define acá: ya existe en lib/mantenimiento/programacion.ts con
// los mismos tres valores y el mismo significado —los turnos del taller—.
// Definir un segundo es cómo se separan sin que nada avise.
import type { Turno } from "@/lib/mantenimiento/programacion";

export const DURACION_OT_MINUTOS = 90;
export const INVITADOS_DE_UNA_OT: readonly string[];  // los cinco, en el orden de la spec

/** El horario de una OT en el calendario: arranca con el turno y dura 1:30. */
export function horarioDeLaOT(fecha: string, turno: Turno): { inicio: string; fin: string };

/** Qué está mal en lo que entró, todo junto y en castellano. Vacío = está bien. */
export function problemasDelEvento(e: {
  titulo: string; inicio: string; fin: string; invitados: string[];
}): string[];

// divergencia.ts
export type Divergencia = "borrado" | "movido";

/**
 * Qué cambió del otro lado, comparando contra lo último que el SdG escribió.
 * `null` = nada que contar.
 */
export function queDivergio(
  escrito: { inicio: string; fin: string } | null,
  enGoogle: { inicio: string; fin: string; cancelado: boolean; titulo?: string;
              invitados: { email: string; respuesta?: string }[] } | null
): Divergencia | null;
```

- [ ] **Step 1: Escribir los tests que fallan**

`lib/agenda/evento.test.ts`:

```ts
it("el turno 4-12 arranca a las 04:00 y termina 1:30 después", () => {
  expect(horarioDeLaOT("2026-11-03", "4-12")).toEqual({ inicio: "2026-11-03T04:00:00", fin: "2026-11-03T05:30:00" });
});
it("el turno 8-16 arranca a las 08:00", () => {
  expect(horarioDeLaOT("2026-11-03", "8-16")).toEqual({ inicio: "2026-11-03T08:00:00", fin: "2026-11-03T09:30:00" });
});
it("el turno 12-20 arranca a las 12:00", () => {
  expect(horarioDeLaOT("2026-11-03", "12-20")).toEqual({ inicio: "2026-11-03T12:00:00", fin: "2026-11-03T13:30:00" });
});
it("los cinco invitados de una OT son los de la spec", () => {
  expect(INVITADOS_DE_UNA_OT).toEqual([
    "nicolaslenzetti@polcecal.com", "gerencia@polcecal.com", "produccion@polcecal.com",
    "mantenimiento@polcecal.com", "soporte.mantenimiento@polcecal.com",
  ]);
});
it("un fin igual al inicio no pasa", () => { /* problemasDelEvento → incluye "El evento tiene que terminar después de que empieza" */ });
it("un fin anterior al inicio no pasa", () => { /* idem */ });
it("un mail mal escrito se nombra, y se nombra ése", () => {
  const p = problemasDelEvento({ titulo: "x", inicio: "2026-11-03T08:00:00", fin: "2026-11-03T09:30:00",
                                 invitados: ["ok@polcecal.com", "sin-arroba"] });
  expect(p.join(" ")).toContain("sin-arroba");
});
it("informa todos los problemas juntos, no de a uno", () => { /* título vacío + fin malo → 2 */ });
```

`lib/agenda/divergencia.test.ts`:

```ts
it("cancelado es un borrado", () => { /* cancelado: true → "borrado" */ });
it("que Google no lo tenga también es un borrado", () => { /* enGoogle null → "borrado" */ });
it("otro inicio es movido", () => { /* → "movido" */ });
it("otro fin es movido", () => { /* → "movido" */ });
it("igual que lo escrito no es nada", () => { /* → null */ });

// Review Focus 1: el eco de las propias escrituras del SdG.
it("lo que el SdG acaba de escribir no es divergencia", () => {
  // `escrito` se actualiza en cada escritura propia, así que la notificación
  // que Google manda por ese cambio llega comparando igual contra igual.
  expect(queDivergio({ inicio: "2026-11-03T12:00:00-03:00", fin: "2026-11-03T13:30:00-03:00" },
    { inicio: "2026-11-03T12:00:00-03:00", fin: "2026-11-03T13:30:00-03:00", cancelado: false, invitados: [] })).toBeNull();
});

// Review Focus 2: el cambio que más veces va a llegar.
it("que un invitado acepte o rechace no es divergencia", () => {
  expect(queDivergio({ inicio: "2026-11-03T08:00:00-03:00", fin: "2026-11-03T09:30:00-03:00" },
    { inicio: "2026-11-03T08:00:00-03:00", fin: "2026-11-03T09:30:00-03:00", cancelado: false,
      invitados: [{ email: "gerencia@polcecal.com", respuesta: "declined" }] })).toBeNull();
});
it("cambiar el título o los invitados tampoco es divergencia", () => { /* mismo inicio y fin, otro título → null */ });

it("un evento que el SdG todavía no escribió no diverge", () => {
  expect(queDivergio(null, { inicio: "x", fin: "y", cancelado: false, invitados: [] })).toBeNull();
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run lib/agenda/`
Expected: FAIL — los módulos no existen.

- [ ] **Step 3: Implementar los dos archivos**

`horarioDeLaOT` arma las cadenas con las horas de la tabla de constantes y los
90 minutos; sin `Date`, que arrastraría la zona del servidor —que es UTC—.
`problemasDelEvento` devuelve **todos** los problemas, como `validar()` de
`lib/core/validar.ts`: informar de a uno es la vara que el repo ya rechazó.
`queDivergio` mira `cancelado`, después la ausencia, después inicio y fin; **no
mira nada más**, y el docstring dice por qué: con cinco invitados por OT, contar
los RSVP haría sonar cada OT hasta cinco veces y la gente apagaría las
notificaciones.

- [ ] **Step 4: Correr los tests**

Run: `npx vitest run lib/agenda/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit --only lib/agenda/evento.ts lib/agenda/evento.test.ts lib/agenda/divergencia.ts lib/agenda/divergencia.test.ts -m "feat(agenda): la logica pura de los eventos y de la divergencia"
```

---

### Tarea 5: Las rutas de la Agenda

**Files:**
- Create: `app/api/agenda/eventos/route.ts` (POST y GET),
  `app/api/agenda/eventos/[id]/route.ts` (PATCH y DELETE),
  `app/api/agenda/eventos/[id]/visto/route.ts` (POST),
  `app/api/agenda/eventos/[id]/destrabar/route.ts` (POST),
  `lib/agenda/escribirEnGoogle.ts`
- Test: `lib/agenda/escribirEnGoogle.test.ts`

**Interfaces:**
- Consumes: `crearEvento`/`actualizarEvento`/`borrarEvento` de la Tarea 3;
  `problemasDelEvento` de la Tarea 4; las tablas de la Tarea 2.
- Produces:

```ts
/**
 * Escribe un evento en Google y devuelve qué anotar en la fila. Nunca tira:
 * un fallo vuelve como `pendiente` con lo que dijo Google, sin traducir.
 */
export async function escribirEnGoogle(
  accion: "crear" | "actualizar" | "borrar",
  fila: { casilla: string; google_event_id: string | null; inicio: string; fin: string },
  evento?: EventoParaGoogle
): Promise<{ google_event_id?: string; inicio_escrito?: string; fin_escrito?: string; pendiente?: string }>;
```

- [ ] **Step 1: Escribir los tests que fallan** en `lib/agenda/escribirEnGoogle.test.ts`:

```ts
it("al crear devuelve el id de Google y lo que se escribió", async () => { /* google_event_id, inicio_escrito, fin_escrito */ });
it("un fallo de Google vuelve como pendiente con el texto de Google sin traducir", async () => {
  // El mensaje tiene que contener lo que dijo Google, no un "no se pudo guardar".
});
it("un fallo no deja inicio_escrito a medias", async () => { /* no devuelve inicio_escrito si no escribió */ });
it("destrabar reescribiendo deja lo del SdG y limpia la divergencia", async () => { /* divergencia null, inicio_escrito = el del SdG */ });
it("destrabar aceptando trae lo de Google a la fila", async () => { /* inicio = el de Google, divergencia null */ });
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run lib/agenda/escribirEnGoogle.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `escribirEnGoogle` y las tres rutas**

`escribirEnGoogle` envuelve al cliente y traduce un fallo en `pendiente`.

`POST /api/agenda/eventos`: valida con `problemasDelEvento` y devuelve **400 con
todos los problemas juntos, en castellano** (Review Focus 3 y 4); la casilla
dueña es el email del usuario de la sesión; inserta la fila y sus invitados,
escribe en Google, y anota el id o el pendiente. Si quedó pendiente, la
respuesta **lo dice** — quien hizo la acción tiene que enterarse.

`GET /api/agenda/eventos`: los del usuario, que RLS ya recorta a «míos o donde
estoy invitado». `traerTodo()`.

`PATCH` y `DELETE` sobre `[id]`: **sólo el dueño**; 403 si no. El DELETE borra
primero en Google y después la fila — al revés deja el evento vivo sin fila que
lo nombre.

`POST .../visto`: inserta o actualiza `agenda_divergencias_vistas` con el
`divergencia_el` que la fila tiene en ese momento, así una divergencia nueva
vuelve a aparecer. **Apaga la campana y nada más**: no destraba el evento.

`POST .../destrabar`, con `{ como: "reescribir" | "aceptar" }`, **sólo el
dueño**. Es lo que vuelve a atar el evento al SdG, y sin esto un evento que
divergió **queda muerto para siempre**, porque la Tarea 8 deja de escribirlo:

- `reescribir` manda a Google lo que dice el SdG y actualiza
  `inicio_escrito`/`fin_escrito`;
- `aceptar` trae lo que dice Google a `inicio`/`fin` de la fila y marca eso
  como lo escrito.

Las dos dejan `divergencia` y `divergencia_el` en null.

- [ ] **Step 4: Correr los tests y `tsc`**

Run: `npx vitest run lib/agenda/ && npx tsc --noEmit`
Expected: PASS y sin errores.

- [ ] **Step 5: Commit**

```bash
git commit --only lib/agenda/escribirEnGoogle.ts lib/agenda/escribirEnGoogle.test.ts app/api/agenda -m "feat(agenda): las rutas para crear, editar y borrar un evento"
```

---

### Tarea 6: La pantalla `/agenda`

**Files:**
- Create: `app/(app)/agenda/page.tsx`, `app/(app)/agenda/AgendaClient.tsx`,
  `app/(app)/agenda/EventoModal.tsx`
- Modify: `lib/core/nav.ts`

**Interfaces:**
- Consumes: las rutas de la Tarea 5.

- [ ] **Step 1: Agregar la entrada al menú**

En `NAV` de `lib/core/nav.ts`, `{ label: "Agenda", href: "/agenda" }`, **sin
`modulo`** — la ven los catorce, como Inicio. Un comentario al lado diciendo que
la ausencia de `modulo` es deliberada y no un olvido.

- [ ] **Step 2: Escribir la pantalla**

Lista de los eventos propios, los próximos primero, con el pasado detrás. Cada
uno muestra título, día y horario, los invitados, y **si divergió, lo dice
encima** con qué pasó y un botón de «Ya lo vi». Los eventos que vienen de una OT
se distinguen y enlazan a la orden.

Al dueño de un evento divergido se le muestran además las dos salidas de
`/destrabar` —«Volver a poner lo del sistema» y «Aceptar lo de Google»—, y se
le dice que **hasta que elija una, el sistema no lo va a mover solo**. Sin eso,
el evento de una OT se queda en el día viejo aunque la planilla la mueva, y
nadie entiende por qué.

El modal de alta y edición: título, día, hora de inicio, hora de fin,
descripción, lugar e invitados. Los invitados salen de los usuarios del SdG
**y además** se puede escribir un mail cualquiera. Editar y borrar sólo
aparecen si sos el dueño.

Las reglas de pantalla del repo: `<Select>` y no `<select>`;
`grid-cols-1 sm:grid-cols-3`; el ancho en un `div` que envuelva al campo.

- [ ] **Step 3: Verificar que entra en un teléfono**

Run: `node scripts/revisar-responsive.mjs`
Expected: ROMPE 0 · APRETADO 0 · MIRAR 0.

- [ ] **Step 4: Verificar el tipado y el build**

Run: `npx tsc --noEmit && npm run build`
Expected: sin errores. (Parar `npm run dev` antes del build.)

- [ ] **Step 5: Commit**

```bash
git commit --only "app/(app)/agenda" lib/core/nav.ts -m "feat(agenda): la pantalla de la agenda y su entrada en el menu"
```

---

### Tarea 7: Mandar una OT al calendario

**Files:**
- Create: `app/api/mantenimiento/ordenes/[id]/calendario/route.ts`,
  `app/(app)/mantenimiento/ordenes/MandarAlCalendarioModal.tsx`
- Modify: `app/(app)/mantenimiento/ordenes/OrdenesClient.tsx`

**Interfaces:**
- Consumes: `horarioDeLaOT` e `INVITADOS_DE_UNA_OT` de la Tarea 4;
  `escribirEnGoogle` de la Tarea 5.

- [ ] **Step 1: Escribir el test que falla**, en `lib/agenda/evento.test.ts`:

```ts
it("una OT sin fecha de ejecución no se puede mandar", () => {
  expect(problemasDeMandarLaOT({ fecha_ejecucion: null, turno: "8-16" }))
    .toContain("La OT no tiene fecha de ejecución: primero hay que ponerle una");
});
it("la fecha que manda es la pendiente cuando la hay", () => {
  expect(fechaParaElCalendario({ fecha_ejecucion: "2026-11-03", fecha_ejecucion_pendiente: "2026-11-10" }))
    .toBe("2026-11-10");
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run lib/agenda/evento.test.ts`
Expected: FAIL — las dos funciones no existen.

- [ ] **Step 3: Implementar las dos funciones, la ruta y el modal**

`fechaParaElCalendario` prefiere `fecha_ejecucion_pendiente` sobre
`fecha_ejecucion`: es la fecha que el SdG fijó y que la planilla todavía no
devolvió, y es la que la persona acaba de elegir.

La ruta `POST .../calendario` recibe el turno y los invitados extra, arma el
evento con los cinco fijos más los que vengan, y **reemplaza** el evento si la
OT ya tenía uno (`ot_id` es `unique`): se mueve al turno nuevo, no se duplica.
La casilla dueña es la del usuario que generó la OT.

En `OrdenesClient.tsx`, el botón. **Deshabilitado y diciendo por qué** si la OT
no tiene fecha de ejecución.

- [ ] **Step 4: Correr los tests y el escaneo de pantallas**

Run: `npx vitest run lib/agenda/ && node scripts/revisar-responsive.mjs`
Expected: PASS y ROMPE 0.

- [ ] **Step 5: Commit**

```bash
git commit --only lib/agenda/evento.ts lib/agenda/evento.test.ts app/api/mantenimiento/ordenes/\[id\]/calendario "app/(app)/mantenimiento/ordenes/MandarAlCalendarioModal.tsx" "app/(app)/mantenimiento/ordenes/OrdenesClient.tsx" -m "feat(agenda): mandar una OT al calendario eligiendo el turno"
```

---

### Tarea 8: El evento sigue a la OT

**Files:**
- Create: `lib/agenda/elEventoSigueALaOT.ts`
- Test: `lib/agenda/elEventoSigueALaOT.test.ts`
- Modify: `lib/mantenimiento/sincronizar.ts`, `lib/core/borradoDeEspejo.ts`

**Interfaces:**
- Consumes: `escribirEnGoogle` (Tarea 5), `horarioDeLaOT` (Tarea 4).
- Produces:

```ts
/** Qué hacer con el evento de una OT cuya fecha cambió. */
export function queHacerConElEvento(
  evento: { inicio: string; turno: Turno; divergencia: string | null },
  fechaNueva: string | null
): { accion: "mover"; inicio: string; fin: string }
 | { accion: "no tocar"; motivo: string }
 | { accion: "avisar"; motivo: string };
```

- [ ] **Step 1: Escribir los tests que fallan**

```ts
it("si la fecha cambió, el evento se mueve al mismo turno", () => { /* accion "mover", inicio con el turno */ });
it("si la fecha es la misma, no se toca", () => { /* accion "no tocar" */ });

// La decisión 16 de la spec, y la que choca con la 10.
it("un evento que ya divergió no se pisa", () => {
  expect(queHacerConElEvento({ inicio: "...", turno: "8-16", divergencia: "movido" }, "2026-11-10"))
    .toEqual({ accion: "no tocar", motivo: expect.stringContaining("divergió") });
});

// La decisión de la spec sobre la fecha que desaparece: no es "la OT se borró"
// ni "cambió de fecha". Borrar el evento por eso sería adivinar.
it("si la planilla vacía la fecha, el evento queda y se avisa", () => {
  expect(queHacerConElEvento({ inicio: "...", turno: "8-16", divergencia: null }, null))
    .toEqual({ accion: "avisar", motivo: expect.stringContaining("sin fecha de ejecución") });
});

// Review Focus 5.
it("si el borrado en Google falla, la OT no entra en el borrado de espejo", () => { /* la OT queda en la lista de las que no se borran */ });
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run lib/agenda/elEventoSigueALaOT.test.ts`
Expected: FAIL.

- [ ] **Step 3: Enganchar en los dos lados**

En `lib/mantenimiento/sincronizar.ts`, donde ya se resuelve `fecha_ejecucion`
contra `fecha_ejecucion_pendiente` (cerca de la línea 655): para las OT que
tienen evento, consultar `queHacerConElEvento` y mover el que corresponda. Un
fallo va a `google_pendiente` — no hay nadie en pantalla.

En `lib/core/borradoDeEspejo.ts`, antes del `DELETE`: borrar en Google los
eventos de las OT que se van a borrar. **Si alguno falla, esa OT no se borra en
esta corrida** y se reintenta en la próxima. Es la misma forma que el registro
de auditoría, que se escribe antes del borrado: si no entra, no se borra. El
motivo es más fuerte acá y va escrito al lado — un evento que sobrevive a su
fila queda vivo en cinco calendarios y **nadie puede sacarlo nunca más desde el
sistema**.

- [ ] **Step 4: Correr los tests de los tres archivos tocados**

Run: `npx vitest run lib/agenda/ lib/core/borradoDeEspejo.test.ts lib/mantenimiento/sincronizar.test.ts`
Expected: PASS, incluidos los que ya estaban.

- [ ] **Step 5: Commit**

```bash
git commit --only lib/agenda/elEventoSigueALaOT.ts lib/agenda/elEventoSigueALaOT.test.ts lib/mantenimiento/sincronizar.ts lib/core/borradoDeEspejo.ts -m "feat(agenda): el evento sigue a la OT, salvo que alguien ya lo haya tocado"
```

---

### Tarea 9: Los canales de observación y el webhook

**Files:**
- Create: `app/api/agenda/google/route.ts` (el webhook, **público**),
  `app/api/cron/agenda/route.ts`, `lib/agenda/canales.ts`
- Test: `lib/agenda/canales.test.ts`
- Modify: `vercel.json`, `docs/VARIABLES-VERCEL.md`

**Interfaces:**
- Consumes: `abrirCanal`/`cerrarCanal`/`leerEvento` de la Tarea 3;
  `queDivergio` de la Tarea 4.
- Produces:

```ts
/** Los canales que hay que abrir o renovar hoy. */
export function canalesARenovar(
  canales: { casilla: string; vence: string }[],
  casillas: string[],
  ahora: Date
): { casilla: string; motivo: "no existe" | "vence pronto" }[];

/** Revisa los eventos futuros de una casilla contra Google. */
export async function revisarLaCasilla(supabase: SupabaseClient, casilla: string): Promise<{ evento_id: string; divergencia: Divergencia }[]>;
```

- [ ] **Step 1: Escribir los tests que fallan**

```ts
it("una casilla sin canal se abre", () => { /* motivo "no existe" */ });
it("un canal que vence dentro de 24 h se renueva", () => { /* motivo "vence pronto" */ });
it("un canal que vence dentro de una semana no se toca", () => { /* no aparece */ });
it("una casilla que ya no es usuario no se renueva", () => { /* no aparece */ });
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run lib/agenda/canales.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar el webhook, el cron y `canales.ts`**

El webhook `POST /api/agenda/google` es **público** —Google no inicia sesión—,
así que se verifica por el `X-Goog-Channel-Token`, que es el `secreto` guardado
en `agenda_canales`. Un token que no coincide es 401 y no se mira nada más.

Qué hace cuando lo llaman: Google **no dice qué cambió**, sólo que algo cambió.
En vez de guardar `syncToken`, el SdG relee **sus propias filas futuras de esa
casilla** y las compara con `queDivergio`. Es idempotente y a este volumen sale
barato; el docstring lo dice, para que nadie lo "mejore" sin saber qué se
decidió. Lo que encuentra se anota en `divergencia` y `divergencia_el`, y
dispara la Tarea 10.

El cron `GET /api/cron/agenda` hace **dos** cosas, con `revisarElSecreto` de
`lib/core/cron.ts`:

1. **Abre y renueva los canales.** **Un canal muerto no se distingue de uno
   sano**, así que si no puede abrir o renovar alguno, lo registra como fallido
   en `sincronizaciones` nombrando la casilla — un aviso que se apaga solo es
   peor que no tenerlo.
2. **Reintenta los `google_pendiente`.** Es la otra mitad de la decisión «un
   fallo automático va a una cola con reintento»: sin esto la cola se llena y
   no la vacía nadie, y un evento que nunca llegó a Google es un evento que
   para sus invitados no existe. Lo que vuelve a entrar se limpia; lo que falla
   de nuevo se queda con el mensaje **nuevo** de Google, no con el viejo.

En `vercel.json`, el cron: `{"path": "/api/cron/agenda", "schedule": "0 5 * * *"}`
— a las 5 UTC, antes de los otros, porque de esto depende que el resto avise.

En `docs/VARIABLES-VERCEL.md`, documentar la URL pública que los canales
registran (hace falta el dominio completo: Google llama de afuera).

- [ ] **Step 4: Correr los tests y el tipado**

Run: `npx vitest run lib/agenda/ && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit --only lib/agenda/canales.ts lib/agenda/canales.test.ts app/api/agenda/google app/api/cron/agenda vercel.json docs/VARIABLES-VERCEL.md -m "feat(agenda): Google avisa al SdG cuando alguien toca un evento"
```

---

### Tarea 10: La alerta — campana y push al instante

**Files:**
- Create: `lib/agenda/avisoDeDivergencia.ts`
- Test: `lib/agenda/avisoDeDivergencia.test.ts`
- Modify: `lib/home/avisos.ts`, `lib/home/avisosDeUsuario.ts`,
  `app/api/agenda/google/route.ts`

**Interfaces:**
- Consumes: `enviarPush` y el tipo `Aviso` de `lib/core/webpush.ts`;
  `horaEnArgentina` de `lib/core/fechas.ts`.
- Produces: `avisarDeLasDivergencias(supabase, divergencias): Promise<void>`, y
  la clave `agendaDivergencias` en `ConteosParaAvisos`.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
it("avisa al dueño y a los invitados que son usuarios del SdG", () => { /* los 5 que tienen usuario_id */ });
it("un invitado externo no recibe push", () => { /* no está en la lista */ });
it("diez eventos tocados de una vez son una notificación, no diez", () => { /* un solo envío por persona */ });
it("fuera de 7:00–21:00 no se manda y no se encola", () => { /* a las 23:00, cero envíos */ });
it("el payload es plano: title, body y url en el primer nivel", () => {
  expect(Object.keys(aviso).sort()).toEqual(["body", "title", "url"]);
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run lib/agenda/avisoDeDivergencia.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar el aviso al instante y el conteo de la campana**

`avisarDeLasDivergencias` manda **una notificación por corrida y por persona**,
en la ventana 7:00–21:00 de Argentina, sin encolar fuera de ella — las mismas
tres reglas de `lib/core/avisoAlInstante.ts`. El payload es el `Aviso` plano, con
la `url` en el primer nivel y apuntando a `/agenda`.

En el docstring, **por qué esto no pasa por `avisarAQuienDecide()`**: de las tres
condiciones de aquel portón cumple dos —hay una persona nombrada y acaba de
pasar— pero **no es cierto que nada avance hasta que decida**. Se manda igual
porque se pidió instantánea, y la excepción queda escrita acá para que no se lea
como permiso para la próxima.

En `lib/home/avisos.ts`, la entrada:
`{ clave: "agendaDivergencias", id: "agenda-divergencias", titulo: "Eventos del calendario que alguien cambió desde Google", href: "/agenda" }`.
**Id nuevo**: la `cantidad` se compara contra la foto del día anterior, y un id
reusado haría salir una novedad falsa.

En `lib/home/avisosDeUsuario.ts`, el conteo. **No es como los otros doce**: la
Agenda no es un módulo, así que no pasa por `contarSiTiene`, y el número depende
de quién mira —sus eventos con `divergencia` no nula que él todavía no dio por
vista—. Eso obliga a que `avisosDeLosModulos` reciba el `usuarioId`, que
`avisosDeUsuario` ya tiene en `quien.id`. Dejarlo comentado ahí: es la primera
entrada de la lista que no se gatea por módulo.

- [ ] **Step 4: Correr los tests de los avisos enteros**

Run: `npx vitest run lib/agenda/ lib/home/`
Expected: PASS, incluidos los que ya estaban.

- [ ] **Step 5: Commit**

```bash
git commit --only lib/agenda/avisoDeDivergencia.ts lib/agenda/avisoDeDivergencia.test.ts lib/home/avisos.ts lib/home/avisosDeUsuario.ts app/api/agenda/google -m "feat(agenda): la divergencia avisa en la campana y en el momento"
```

---

### Tarea 11: Cerrar — la documentación y las seis verificaciones

**Files:**
- Create: `docs/AGENDA.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Escribir `docs/AGENDA.md`**

Lo que no se deduce del código: que el SdG manda y Google es el espejo pero
**avisa** en vez de pisar; que divergencia son sólo borrado y movido, y por qué
los RSVP quedan afuera con el número al lado; que un evento borrado vuelve con
200 y `status: "cancelled"`; que nueve de los catorce calendarios están en UTC;
que los canales vencen y un canal muerto se ve igual que uno sano; y que la
delegación de dominio está autorizada para el client ID `101499089090401417948`.

- [ ] **Step 2: Agregar la fila a la tabla de módulos de `CLAUDE.md`**

Una fila `| Agenda | docs/AGENDA.md · spec · plan |` con las dos o tres cosas
que no se deducen del código, en el estilo de las demás.

- [ ] **Step 3: Correr las seis verificaciones**

```bash
npm test
npx tsc --noEmit
npm run build
node scripts/revisar-arbol-commiteado.mjs
node scripts/revisar-responsive.mjs
node scripts/revisar-exportaciones.mjs
```

Expected: todo verde. `revisar-exportaciones` **no debería** reclamar nada —
Calendar no es una planilla—; si reclama, hay una escritura a Sheets que se
coló y hay que declararla.

- [ ] **Step 4: Commit**

```bash
git commit --only docs/AGENDA.md CLAUDE.md -m "docs(agenda): lo que no se deduce del codigo de la agenda"
```
