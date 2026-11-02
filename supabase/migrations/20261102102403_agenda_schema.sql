-- ============================================================
-- SdG — Agenda: eventos que se espejan en Google Calendar
--
-- Una agenda dentro del SdG cuyos eventos se escriben también en el Google
-- Calendar de quien corresponda, para que lo vea quien no entra al sistema. Las
-- órdenes de trabajo programadas del taller entran ahí solas (`ot_id`).
--
-- EL SdG ES EL DUEÑO Y GOOGLE ES EL ESPEJO. Lo que dice esta base es lo que vale;
-- el evento de Google es una copia que se reescribe. Por eso la mayoría de las
-- columnas de Google son bookkeeping y no datos: `google_event_id` para encontrar
-- la copia, `google_pendiente` para lo que no pudo escribirse (con lo que dijo
-- Google, sin traducir: un diagnóstico que no se distingue de otro no es un
-- diagnóstico), y `casilla` para saber en qué calendario vive.
--
-- `inicio_escrito` y `fin_escrito` EXISTEN SÓLO PARA DISTINGUIR EL ECO. Cuando
-- el SdG escribe un evento, Google avisa por el canal de notificaciones que
-- «cambió» — el aviso llega también por lo que acabamos de escribir nosotros. Lo
-- único que separa ese eco de un cambio hecho por una persona en Google es
-- comparar lo que Google trae contra lo que el SdG escribió por última vez, y eso
-- es lo que guardan estas dos columnas. No son la fecha del evento (esa es
-- `inicio`/`fin`) y nadie más debería leerlas: si se las usa como fecha, el día
-- que Google desplace un evento mostrarían la fecha que el SdG quiso y no la que
-- hay.
--
-- `divergencia_el` SE COMPARA CONTRA `agenda_divergencias_vistas.divergencia_el`.
-- «Dar por vista» una divergencia es guardar la fecha de ésa; si el evento vuelve
-- a divergir, `divergencia_el` cambia y deja de coincidir con lo guardado, así
-- que la alerta reaparece sola. Un booleano «vista» no lo haría: una vez en true,
-- la divergencia siguiente quedaría tapada, que es el error silencioso. Y cada
-- persona la da por vista por su cuenta, de ahí la clave `(evento_id, usuario_id)`.
--
-- `aviso` NO ES `google_pendiente`, a propósito. `google_pendiente` es un fallo de
-- escritura; `aviso` es algo que una persona tiene que mirar y que no falló ni
-- divergió —hoy, que la planilla vació la fecha de ejecución de la OT del
-- evento—. Metidos en la misma columna, dos diagnósticos distintos se verían
-- iguales.
--
-- EL `on delete cascade` DE `ot_id` ES UNA RED Y NO EL MECANISMO. Borrar una OT
-- se lleva en cascada sus notas, sus repuestos y su aviso (medido con
-- `scripts/que-cuelga-de.mjs ordenes_trabajo`), y con esto también su evento de
-- la agenda. Pero el evento de Google NO se borra solo: si la fila se va por la
-- cascada, la copia queda huérfana en el calendario de alguien y ya no hay fila
-- que diga dónde está (`google_event_id` se fue con ella). Quien borra el evento
-- de Google es la aplicación, ANTES de que la OT se borre (Tarea 8 del plan). La
-- cascada sólo evita una fila colgando si ese paso falla; no hace lo que parece.
--
-- LA POLICY DE LOS INVITADOS NO PUEDE MIRAR A `agenda_eventos` DIRECTAMENTE.
-- `agenda_eventos_ver` consulta `agenda_invitados` y, si la policy de
-- `agenda_invitados` consultara `agenda_eventos`, cada una dispararía a la otra:
-- Postgres lo corta con `42P17: infinite recursion detected in policy`, y lo
-- hace al primer `select`, no al crear la policy. Por eso la de los invitados
-- pregunta por la función `agenda_veo_evento()`, que lee las dos tablas como
-- `security definer` y sin pasar por RLS. Va sin envolver en `(select …)` por la
-- razón de abajo.
--
-- LAS POLICIES LLAMAN A `auth.uid()` ENVUELTO —`(select auth.uid())`— SALVO
-- CUANDO LA CONDICIÓN DEPENDE DE UNA COLUMNA DE LA FILA. Envolver evalúa una sola
-- vez, y eso es una optimización para lo que no cambia de fila en fila. El
-- `exists` sobre los invitados de `agenda_eventos_ver` y la llamada a
-- `agenda_veo_evento(evento_id)` dependen de la fila: envueltos, se evaluarían
-- con la del primero y a cada uno le mostrarían los eventos del primero. Es el
-- único error de este tema que es un agujero de permisos y no una lentitud. Las
-- dos van sin envolver y con el comentario encima.
--
-- `agenda_canales` NO SE EXPONE: tiene RLS activada y ninguna policy, así que
-- ningún cliente con sesión la lee ni la escribe. Guarda el `secreto` con el que
-- se valida que el aviso de Google es de Google; lo escribe sólo el cliente admin.
--
-- Diseño: docs/superpowers/specs/2026-10-30-agenda-y-google-calendar-design.md
-- Plan:   docs/superpowers/plans/2026-11-02-agenda-y-google-calendar.md (Tarea 2)
-- ============================================================

-- ── 1. Las tablas ────────────────────────────────────────────

create table if not exists public.agenda_eventos (
  id                  uuid primary key default gen_random_uuid(),
  titulo              text not null,
  descripcion         text,
  lugar               text,
  inicio              timestamptz not null,
  fin                 timestamptz not null,
  dueno_id            uuid not null references public.usuarios(id) on delete cascade,
  casilla             text not null,
  google_event_id     text,
  inicio_escrito      timestamptz,
  fin_escrito         timestamptz,
  divergencia         text check (divergencia in ('borrado', 'movido')),
  divergencia_el      timestamptz,
  google_pendiente    text,
  google_pendiente_el timestamptz,
  -- Algo que una persona tiene que mirar y que NO es un fallo de escritura ni
  -- una divergencia. Ver el encabezado.
  aviso               text,
  -- Red y no mecanismo: el evento de Google lo borra la aplicación antes.
  ot_id               uuid unique references public.ordenes_trabajo(id) on delete cascade,
  turno               text check (turno in ('4-12', '8-16', '12-20')),
  created_at          timestamptz not null default now(),
  check (fin > inicio)
);

create index if not exists agenda_eventos_dueno_idx   on public.agenda_eventos (dueno_id);
create index if not exists agenda_eventos_inicio_idx  on public.agenda_eventos (inicio);
create index if not exists agenda_eventos_casilla_idx on public.agenda_eventos (casilla);

create table if not exists public.agenda_invitados (
  id         uuid primary key default gen_random_uuid(),
  evento_id  uuid not null references public.agenda_eventos(id) on delete cascade,
  email      text not null,
  usuario_id uuid references public.usuarios(id) on delete set null,
  unique (evento_id, email)
);

create index if not exists agenda_invitados_usuario_idx on public.agenda_invitados (usuario_id);

create table if not exists public.agenda_divergencias_vistas (
  evento_id      uuid not null references public.agenda_eventos(id) on delete cascade,
  usuario_id     uuid not null references public.usuarios(id) on delete cascade,
  divergencia_el timestamptz not null,
  primary key (evento_id, usuario_id)
);

create table if not exists public.agenda_canales (
  id         uuid primary key default gen_random_uuid(),
  casilla    text not null unique,
  canal_id   text not null,
  recurso_id text not null,
  secreto    text not null,
  vence      timestamptz not null,
  created_at timestamptz not null default now()
);

-- ── 2. Quién ve un evento ────────────────────────────────────
-- `security definer` para leer `agenda_eventos` y `agenda_invitados` sin pasar
-- por sus policies: es lo que corta la recursión (ver el encabezado). Hace lo
-- mismo que `agenda_eventos_ver` y tienen que seguir diciendo lo mismo: dueño o
-- invitado.

create or replace function public.agenda_veo_evento(p_evento_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    exists (
      select 1 from agenda_eventos e
       where e.id = p_evento_id
         and e.dueno_id = auth.uid()
    )
    or exists (
      select 1 from agenda_invitados i
       where i.evento_id = p_evento_id
         and i.usuario_id = auth.uid()
    ),
    false
  )
$$;

-- ── 3. RLS ───────────────────────────────────────────────────

alter table public.agenda_eventos              enable row level security;
alter table public.agenda_invitados            enable row level security;
alter table public.agenda_divergencias_vistas  enable row level security;
alter table public.agenda_canales              enable row level security;

-- Un evento lo ve su dueño o quien esté invitado y sea usuario del SdG.
--
-- OJO: ESTE `exists` NO SE ENVUELVE EN `(select …)`. Depende de una columna de la
-- fila (`agenda_eventos.id`), así que evaluarlo una sola vez le mostraría a cada
-- uno los eventos del primero que consultó. Es un agujero y no una lentitud. El
-- `auth.uid()` de adentro sí va envuelto: ése no cambia de fila en fila.
drop policy if exists agenda_eventos_ver on public.agenda_eventos;
create policy agenda_eventos_ver on public.agenda_eventos
  for select using (
    dueno_id = (select auth.uid())
    or exists (
      select 1 from public.agenda_invitados i
       where i.evento_id = agenda_eventos.id
         and i.usuario_id = (select auth.uid())
    )
  );

-- Crear, editar y borrar: sólo el dueño. Un invitado lo ve y no lo toca.
drop policy if exists agenda_eventos_crear on public.agenda_eventos;
create policy agenda_eventos_crear on public.agenda_eventos
  for insert with check (dueno_id = (select auth.uid()));

drop policy if exists agenda_eventos_editar on public.agenda_eventos;
create policy agenda_eventos_editar on public.agenda_eventos
  for update using (dueno_id = (select auth.uid()));

drop policy if exists agenda_eventos_borrar on public.agenda_eventos;
create policy agenda_eventos_borrar on public.agenda_eventos
  for delete using (dueno_id = (select auth.uid()));

-- Los invitados de un evento se ven si se ve el evento.
--
-- OJO: TAMPOCO SE ENVUELVE. `agenda_veo_evento(evento_id)` recibe una columna de
-- la fila; envuelta, se evaluaría una vez y le mostraría a cada uno los
-- invitados de los eventos del primero. Y no puede ser un `exists` sobre
-- `agenda_eventos`: eso es la recursión del encabezado.
--
-- Sólo hay policy de lectura. Quien escribe invitados es la aplicación, con el
-- cliente admin, junto con el evento de Google que los invita.
drop policy if exists agenda_invitados_ver on public.agenda_invitados;
create policy agenda_invitados_ver on public.agenda_invitados
  for select using (public.agenda_veo_evento(evento_id));

-- Cada uno da por vistas las suyas. Las tres con `usuario_id` propio: nadie
-- marca como vista una divergencia a nombre de otro.
drop policy if exists agenda_divergencias_vistas_ver on public.agenda_divergencias_vistas;
create policy agenda_divergencias_vistas_ver on public.agenda_divergencias_vistas
  for select using (usuario_id = (select auth.uid()));

drop policy if exists agenda_divergencias_vistas_crear on public.agenda_divergencias_vistas;
create policy agenda_divergencias_vistas_crear on public.agenda_divergencias_vistas
  for insert with check (usuario_id = (select auth.uid()));

drop policy if exists agenda_divergencias_vistas_actualizar on public.agenda_divergencias_vistas;
create policy agenda_divergencias_vistas_actualizar on public.agenda_divergencias_vistas
  for update using (usuario_id = (select auth.uid()))
  with check (usuario_id = (select auth.uid()));

-- `agenda_canales`: sin policy, a propósito. Ver el encabezado.
