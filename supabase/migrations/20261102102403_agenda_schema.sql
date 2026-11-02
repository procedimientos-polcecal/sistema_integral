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
-- Eso incluye el camino que no pasa por una ruta: el borrado de espejo de la
-- sincronización de OT (`borradoDeEspejo`). Decidido: si el borrado en Google
-- falla, esa OT NO se borra en esa corrida y se reintenta en la siguiente.
--
-- EL `on delete cascade` DE `dueno_id` TIENE EL MISMO AGUJERO Y ES PEOR, porque
-- los usuarios SE BORRAN DE VERDAD: `app/api/administracion/usuarios/[id]/route.ts`
-- hace un `delete` real. Borrar una persona se lleva en silencio todos sus
-- eventos y deja las copias vivas en el calendario de los invitados, sin ninguna
-- fila que las encuentre. LA RUTA DE BORRADO DE USUARIO NO LO CONTEMPLA HOY y
-- queda pendiente: tiene que borrar los eventos de Google de esa persona antes de
-- borrarla.
--
-- EL EVENTO DE UNA OT NO ES LA AGENDA PERSONAL DE NADIE: PERTENECE A LA ORDEN
-- (lo prueban los cinco invitados fijos que trae). Cuando una persona manda al
-- calendario una OT que ya tenía evento en OTRA casilla, el `update` lo hace el
-- cliente admin y el dueño NO cambia. Por eso esta tabla tiene una escritura que
-- no pasa por RLS: la policy de editar sólo deja al dueño, y quien manda la OT
-- puede no serlo.
--
-- `agenda_divergencias_vistas` ES UNA TABLA PUENTE PARA POSTGREST. Su clave
-- `(evento_id, usuario_id)` es el patrón que lee como muchos-a-muchos entre
-- `agenda_eventos` y `usuarios`, y como `agenda_eventos.dueno_id` ya apunta a
-- `usuarios`, a partir de ahora todo `agenda_eventos?select=…,usuarios(nombre)`
-- falla con `PGRST201`. Hay que nombrar por dónde ir: `usuarios!dueno_id(nombre)`.
-- No rompe nada de lo que existe, pero los `select` nuevos lo necesitan.
--
-- LOS PARES DE COLUMNAS VAN ATADOS. `divergencia` / `divergencia_el`,
-- `google_pendiente` / `google_pendiente_el` e `inicio_escrito` / `fin_escrito`
-- se escriben juntos o ninguno: con `divergencia` puesta y `divergencia_el` en
-- null, la comparación contra `agenda_divergencias_vistas` deja de funcionar en
-- silencio y una divergencia no vuelve a aparecer nunca; con medio par de
-- `*_escrito`, la detección del eco falla con el mismo silencio. Los `check` están como `alter table` en un bloque que
-- mira antes de agregar, y no dentro del `create table`, para que la segunda
-- corrida los traiga si la tabla ya existía.
--
-- PARA QUIEN LA APLIQUE: ESTA MIGRACIÓN SE PUEDE CORRER DE NUEVO Y ES SEGURO.
-- «Todavía no se aplicó» no es un estado que se pueda conocer desde acá: si una
-- versión anterior de este archivo ya corrió, la segunda corrida es la que trae
-- las policies de escritura de los invitados, el `with check` de editar eventos,
-- el `agenda_veo_evento` en `agenda_eventos_ver`, los índices nuevos y los
-- `check` de los pares. (Las columnas y las tablas no cambian de una versión a
-- otra.)
--
-- ANTES DE DAR POR BUENA ESTA MIGRACIÓN, QUIEN LA APLIQUE TIENE QUE HACER UN
-- `select` DE CADA TABLA CON DOS USUARIOS: uno ajeno al evento (que no tiene que
-- ver ni el evento ni sus invitados) y uno invitado (que tiene que ver los dos).
-- Es lo único que prueba de verdad que no hay recursión: el error `42P17` no
-- sale al crear las policies sino en el primer `select`, y ningún test de este
-- repo corre contra la base con RLS.
--
-- LAS POLICIES DE EVENTOS Y DE INVITADOS NO SE MIRAN ENTRE SÍ DIRECTAMENTE.
-- Quién ve un evento depende de sus invitados, y quién ve a los invitados
-- depende del evento: con un `exists` en cada punta, cada policy dispararía a la
-- otra y Postgres lo corta con `42P17: infinite recursion detected in policy`,
-- y lo hace al primer `select`, no al crear la policy. Por eso las dos preguntan
-- por la función `agenda_veo_evento()`, que lee las dos tablas como `security
-- definer` y sin pasar por RLS: una sola fuente de verdad para «quién ve un
-- evento», que además evita pagar una expansión de RLS por cada fila de
-- invitados examinada. Va sin envolver en `(select …)` por la razón de abajo.
--
-- DE QUÉ DEPENDE QUE NO HAYA RECURSIÓN: de que el cuerpo de esas funciones corre
-- como el dueño de las tablas, y el dueño no paga sus propias policies. Eso se
-- rompe si alguien pone `force row level security` en `agenda_eventos` o en
-- `agenda_invitados`: la recursión vuelve, y vuelve peor. Con un `exists` inline
-- Postgres la detecta al planificar y da `42P17`; con una llamada a función no
-- hay detección y se va hasta `54001 stack depth limit exceeded`. No se pone.
--
-- Escribir invitados es del dueño y se resuelve igual, con su hermana
-- `agenda_soy_dueno()`: un `exists` directo sobre `agenda_eventos` también
-- terminaría, pero así las policies de invitados dicen lo mismo de la misma forma.
--
-- VER NO ES PODER TOCAR. Un invitado ve el evento y a sus invitados, y no los
-- cambia: insertar y borrar invitados es del dueño. Y la de editar un evento
-- lleva `with check` además de `using`: el `using` mira la fila vieja, así que
-- sin el `with check` un dueño puede mandar un update que cambie `dueno_id` a
-- otra persona y pasa.
--
-- LAS POLICIES LLAMAN A `auth.uid()` ENVUELTO —`(select auth.uid())`— SALVO
-- CUANDO LA CONDICIÓN DEPENDE DE UNA COLUMNA DE LA FILA. Envolver evalúa una sola
-- vez, y eso es una optimización para lo que no cambia de fila en fila. Las
-- llamadas a `agenda_veo_evento(…)` y a `agenda_soy_dueno(…)` reciben una columna
-- de la fila: envueltas, se evaluarían con la del primero y a cada uno le
-- mostrarían los eventos del primero. Es el único error de este tema que es un
-- agujero de permisos y no una lentitud. Van sin envolver y con el comentario
-- encima de cada policy.
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

-- Los pares atados (ver el encabezado). Va acá, antes de crear las tablas que
-- referencian a `agenda_eventos`: un `alter table` después de un `create table …
-- references` sobre ella sería la subida de lock que da `40P01` (README). En una
-- segunda corrida la tabla ya existe y el bloque agrega lo que falte.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.agenda_eventos'::regclass
                    and conname = 'agenda_eventos_divergencia_par') then
    alter table public.agenda_eventos
      add constraint agenda_eventos_divergencia_par
      check ((divergencia is null) = (divergencia_el is null));
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.agenda_eventos'::regclass
                    and conname = 'agenda_eventos_google_pendiente_par') then
    alter table public.agenda_eventos
      add constraint agenda_eventos_google_pendiente_par
      check ((google_pendiente is null) = (google_pendiente_el is null));
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.agenda_eventos'::regclass
                    and conname = 'agenda_eventos_escrito_par') then
    alter table public.agenda_eventos
      add constraint agenda_eventos_escrito_par
      check ((inicio_escrito is null) = (fin_escrito is null));
  end if;
end $$;

create index if not exists agenda_eventos_dueno_idx   on public.agenda_eventos (dueno_id);
create index if not exists agenda_eventos_inicio_idx  on public.agenda_eventos (inicio);
create index if not exists agenda_eventos_casilla_idx on public.agenda_eventos (casilla);
-- El aviso de Google llega con este id (Tarea 9). No es único: un evento sin
-- escribir todavía lo tiene en null.
create index if not exists agenda_eventos_google_event_idx on public.agenda_eventos (google_event_id);

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

-- Las tres policies filtran por `usuario_id` y la clave empieza por `evento_id`,
-- así que no les sirve.
create index if not exists agenda_divergencias_vistas_usuario_idx
  on public.agenda_divergencias_vistas (usuario_id);

create table if not exists public.agenda_canales (
  id         uuid primary key default gen_random_uuid(),
  casilla    text not null unique,
  canal_id   text not null,
  recurso_id text not null,
  secreto    text not null,
  vence      timestamptz not null,
  created_at timestamptz not null default now()
);

-- El aviso de Google entra por el canal, así que se busca por `canal_id`. Un
-- índice único común y no parcial (README, trampa del `ON CONFLICT`).
create unique index if not exists agenda_canales_canal_idx
  on public.agenda_canales (canal_id);

-- ── 2. Quién ve un evento ────────────────────────────────────
-- `security definer` para leer `agenda_eventos` y `agenda_invitados` sin pasar
-- por sus policies: es lo que corta la recursión (ver el encabezado). Es la única
-- definición de «ver un evento»: dueño o invitado. La usan `agenda_eventos_ver` y
-- `agenda_invitados_ver`, y si cambia, cambia para las dos.

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

-- Quién es el dueño de un evento. Hermana de la anterior y por el mismo motivo:
-- las policies de escritura de `agenda_invitados` necesitan saber de quién es el
-- evento sin pasar por la policy de `agenda_eventos`, que a su vez mira a los
-- invitados.

create or replace function public.agenda_soy_dueno(p_evento_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    exists (
      select 1 from agenda_eventos e
       where e.id = p_evento_id
         and e.dueno_id = auth.uid()
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
-- OJO 1: LA LLAMADA NO SE ENVUELVE EN `(select …)`. `agenda_veo_evento(id)`
-- recibe una columna de la fila, así que evaluarla una sola vez le mostraría a
-- cada uno los eventos del primero que consultó. Es un agujero y no una lentitud.
-- No hay recursión mientras la función corra como el dueño de las tablas (ver el
-- encabezado).
--
-- OJO 2: EL DISYUNTO `dueno_id = (select auth.uid())` NO ES REDUNDANTE, Y NO SE
-- «SIMPLIFICA». Cuando un comando lleva `RETURNING`, Postgres aplica las policies
-- de `select` como `with check` sobre la fila nueva, y ahí no filtra: aborta con
-- `42501`. PostgREST escribe siempre el `RETURNING`, incluso con
-- `return=minimal`. Con sólo la llamada a la función, todo `insert … returning`
-- hecho con la sesión de una persona se cae, porque la función vuelve a buscar la
-- fila en la tabla y, siendo `stable`, usa el snapshot de la sentencia que la
-- llama, donde la fila recién insertada todavía no se ve. El disyunto mira la
-- tupla nueva, que está ahí mismo. De paso es el camino barato del dueño: listar
-- sus eventos no paga una llamada a función por fila. Mismo patrón que
-- `asientos_select` en 013_remises_rls.sql.
drop policy if exists agenda_eventos_ver on public.agenda_eventos;
create policy agenda_eventos_ver on public.agenda_eventos
  for select using (
    dueno_id = (select auth.uid())
    or public.agenda_veo_evento(id)
  );

-- Crear, editar y borrar: sólo el dueño. Un invitado lo ve y no lo toca.
drop policy if exists agenda_eventos_crear on public.agenda_eventos;
create policy agenda_eventos_crear on public.agenda_eventos
  for insert with check (dueno_id = (select auth.uid()));

drop policy if exists agenda_eventos_editar on public.agenda_eventos;
create policy agenda_eventos_editar on public.agenda_eventos
  for update using (dueno_id = (select auth.uid()))
  with check (dueno_id = (select auth.uid()));

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
drop policy if exists agenda_invitados_ver on public.agenda_invitados;
create policy agenda_invitados_ver on public.agenda_invitados
  for select using (public.agenda_veo_evento(evento_id));

-- Agregar y sacar invitados: sólo el dueño del evento. Ver no es poder tocar. La
-- ruta de alta los inserta con la sesión de la persona, no con el cliente admin.
-- Mismo motivo de no envolver que arriba: `agenda_soy_dueno(evento_id)` recibe una
-- columna de la fila. No hay policy de update: un invitado se agrega o se saca,
-- no se reescribe.
drop policy if exists agenda_invitados_agregar on public.agenda_invitados;
create policy agenda_invitados_agregar on public.agenda_invitados
  for insert with check (public.agenda_soy_dueno(evento_id));

drop policy if exists agenda_invitados_sacar on public.agenda_invitados;
create policy agenda_invitados_sacar on public.agenda_invitados
  for delete using (public.agenda_soy_dueno(evento_id));

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
