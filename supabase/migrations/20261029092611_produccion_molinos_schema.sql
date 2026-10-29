-- ============================================================
-- SdG — Producción: las tres tablas de los molinos del PC Robot
--
-- Requiere que 20261029091840_produccion_molinos_enums.sql ya haya corrido: los
-- tipos produccion_molino_turno y produccion_molino_estado salen de ahí, y acá
-- sólo se usan. Las funciones tiene_acceso_produccion() y
-- puede_editar_produccion() las define 20260907154336_produccion_schema.sql y
-- se reusan tal cual: esto no crea funciones de permisos nuevas.
--
-- Qué guarda. Los contadores del PC Robot miden lo que entra a cada molino
-- (Filler 1 y Filler 2, éste último el de la Calera), un renglón por turno de
-- cuatro u ocho horas. No es el parte de fábrica de Producción: el parte cuenta
-- producto terminado y esto cuenta lo que se muele, así que no se suman ni
-- comparten tabla. Ver
-- docs/superpowers/specs/2026-10-21-produccion-molinos-desde-el-robot-design.md.
--
-- Tres tablas:
--   produccion_molinos         el catálogo (dos filas). Es dato y no constantes
--                              en el código porque el umbral de "pedir motivo"
--                              y la fecha de puesta en servicio son decisiones
--                              que alguien va a querer mover sin desplegar.
--   produccion_molino_turnos   lo que dice el robot, un renglón por molino y
--                              turno. Lo escribe la importación, nunca una
--                              persona, y se puede rehacer entera desde el zip.
--   produccion_molino_paradas  lo que dice una persona: por qué un molino no
--                              marchó. Esto NO se rehace desde ningún zip, así
--                              que ninguna importación la toca jamás.
--
-- ── POR QUÉ LA UNICIDAD DE LAS PARADAS NO ES UN `unique (molino_id, fecha, turno)` ──
--
-- `turno` es null cuando la parada es del día entero ("planta parada"). Y en
-- Postgres una `unique` común trata los null como DISTINTOS entre sí: dos filas
-- de "planta parada" del mismo molino y del mismo día pasarían las dos, que es
-- exactamente lo que esa restricción viene a impedir. No da error, no avisa:
-- el día queda con dos motivos y cuál manda depende del orden en que se lea.
--
-- La primera idea fue una columna generada, `turno_clave text generated always
-- as (coalesce(turno::text, 'dia')) stored`, con la unique sobre ella —el
-- precedente de columna generada en este repo es `gut_orden`—. NO SE PUEDE, y
-- se midió en un Postgres 15 descartable: falla con "generation expression is
-- not immutable". Un enum se pasa a texto por enum_out, que es STABLE (un enum
-- puede ganar valores), y una expresión generada tiene que ser IMMUTABLE. Es
-- la misma familia de la trampa de `date_trunc` del README de migraciones
-- (42P17), por otro camino. El rodeo con `case turno when '20_00' then ...`
-- sí entra, pero es peor que el problema: un quinto valor del enum caería
-- callado en el `else` y se confundiría con "el día entero".
--
-- Lo que se usa es `unique nulls not distinct` (Postgres 15): los null cuentan
-- como iguales, así que hay una sola "planta parada" por molino y día. Es una
-- constraint completa y no un índice parcial, de modo que sirve de destino de
-- `ON CONFLICT (molino_id, fecha, turno)` —trampa #2 del README— y las rutas
-- pueden hacer upsert sin saber que el turno puede ser null. Si esta
-- migración da error de sintaxis en `nulls not distinct`, la base es anterior a
-- Postgres 15, y lo que hay que hacer es avisar antes de buscar otro rodeo.
--
-- ── POR QUÉ LAS POLICIES LLAMAN A SU FUNCIÓN ENVUELTA ────────────────────────
--
-- `using ((select tiene_acceso_produccion()))` y no `using
-- (tiene_acceso_produccion())`. Pelada, Postgres evalúa el USING una vez por
-- fila aunque la función sea STABLE; el subselect lo vuelve un InitPlan que se
-- evalúa una sola vez. Escribirla pelada no rompe nada y no avisa: la tabla
-- simplemente empieza a costar proporcional a sus filas, y se nota cuando ya
-- creció. Esta crece unas 1.460 filas por molino por año (4 turnos por 365
-- días), o sea que pasa de las mil en el primer año. Mismo criterio de las
-- migraciones 20261014090512 y 20261014104956, que envolvieron las 249 que
-- había y dejaron todo entre ×1,0 y ×1,3 contra la misma consulta sin RLS.
-- Ninguna función de acá recibe una columna de la fila, así que ninguna entra
-- en la excepción que sí se deja pelada.
--
-- ── EL CATÁLOGO Y LO QUE FALTA ───────────────────────────────────────────────
--
-- Dos filas, `filler_1` y `filler_2`, con `prefijo_archivo` igual a como se
-- llaman los zips que ya se suben a Drive. `desde` es la puesta en servicio:
-- el día desde el que corre la cola de "turnos sin explicar", para que el
-- historial previo no llegue como una avalancha de pendientes.
--
-- NO se crea una fila para FILLER3. Aparece en los horímetros del robot y
-- nadie sabe si produce; una fila acá sería declarar que sí. Si resulta que
-- produce, es un insert.
-- ============================================================

-- ── 1. El catálogo de molinos ────────────────────────────────

create table if not exists produccion_molinos (
  id              uuid primary key default gen_random_uuid(),
  clave           text not null unique,
  nombre          text not null,
  -- Cómo vienen armados los CSV de este molino: filler_1 y filler_2 no traen
  -- las mismas columnas, y el parser decide por esto y no por el nombre.
  formato         text not null check (formato in ('filler_1', 'filler_2')),
  -- Con qué empieza el nombre de su zip en Drive. Es texto y no clave porque
  -- lo decide quien nombra los archivos, con el espacio incluido.
  prefijo_archivo text not null,
  -- Cuántos minutos de diferencia entre la marcha y la teórica piden que
  -- alguien diga por qué. Dato y no constante: son cinco hoy, y lo van a
  -- discutir.
  umbral_minutos  int not null default 5 check (umbral_minutos >= 0),
  -- La puesta en servicio. Null = sin fecha, y la cola corre sobre todo.
  desde           date,
  activo          boolean not null default true
);

-- ── 2. Lo que midió el robot ─────────────────────────────────

create table if not exists produccion_molino_turnos (
  id               uuid primary key default gen_random_uuid(),
  -- Sin `on delete`: un molino con turnos no se borra, se desactiva.
  molino_id        uuid not null references produccion_molinos(id),
  fecha            date not null,
  turno            produccion_molino_turno not null,
  kg               numeric not null default 0 check (kg >= 0),
  minutos_marcha   numeric not null default 0 check (minutos_marcha >= 0),
  -- Lo que el turno habría marchado de punta a punta: 240 u 480. Se guarda
  -- y no se deduce del turno porque un turno acumulado o huérfano lo lleva en
  -- cero, y esa diferencia es justamente lo que lo distingue.
  minutos_teoricos numeric not null default 0 check (minutos_teoricos >= 0),
  estado           produccion_molino_estado not null default 'normal',
  -- Kilos por material, {"membranero": 1200, ...}. jsonb y no columnas
  -- porque los materiales los trae el robot y no hay catálogo que los frene.
  por_material     jsonb not null default '{}'::jsonb,

  -- Constraint completa y no índice parcial: es el destino del `ON CONFLICT`
  -- de la importación (trampa #2 del README), y ahí el turno nunca es null.
  unique (molino_id, fecha, turno)
);

-- Lo que lee la pantalla es "este molino, este rango de fechas". La unique de
-- arriba ya arranca por (molino_id, fecha) y lo cubre; no hace falta otro.

-- ── 3. Lo que explicó una persona ────────────────────────────

create table if not exists produccion_molino_paradas (
  id               uuid primary key default gen_random_uuid(),
  molino_id        uuid not null references produccion_molinos(id),
  fecha            date not null,
  -- Null = el día entero: "planta parada". Ver el encabezado de por qué
  -- eso obliga a `nulls not distinct`.
  turno            produccion_molino_turno,
  motivo           text not null,
  -- La OT que explica la parada, si la hay. Verificado con
  -- `node scripts/que-cuelga-de.mjs ordenes_trabajo` el 29/10/2026: esa tabla
  -- ya es destino de otros `set null` (partes de contratista, ejecuciones,
  -- planificación diaria) y de tres cascadas que parten de ella, así que
  -- borrar una OT —que el espejo de la planilla hace cuando la fila se saca
  -- de allá— deja la parada viva y sin enlace. Es lo correcto: el motivo es
  -- lo que escribió una persona y no se pierde porque la OT se haya ido.
  orden_trabajo_id uuid references ordenes_trabajo(id) on delete set null,
  creado_por       uuid references usuarios(id),
  creado_en        timestamptz not null default now(),

  unique nulls not distinct (molino_id, fecha, turno)
);

-- ── 4. RLS ───────────────────────────────────────────────────
-- Cada tabla con una policy de lectura y otra de escritura, las dos con la
-- función envuelta (ver el encabezado). La de escritura es `for all`: sirve
-- para insert, update y delete, y su `with check` repite el `using`.

alter table produccion_molinos        enable row level security;
alter table produccion_molino_turnos  enable row level security;
alter table produccion_molino_paradas enable row level security;

drop policy if exists produccion_molinos_select on produccion_molinos;
create policy produccion_molinos_select on produccion_molinos
  for select to authenticated using ((select tiene_acceso_produccion()));

drop policy if exists produccion_molinos_write on produccion_molinos;
create policy produccion_molinos_write on produccion_molinos
  for all to authenticated
  using ((select puede_editar_produccion()))
  with check ((select puede_editar_produccion()));

drop policy if exists produccion_molino_turnos_select on produccion_molino_turnos;
create policy produccion_molino_turnos_select on produccion_molino_turnos
  for select to authenticated using ((select tiene_acceso_produccion()));

drop policy if exists produccion_molino_turnos_write on produccion_molino_turnos;
create policy produccion_molino_turnos_write on produccion_molino_turnos
  for all to authenticated
  using ((select puede_editar_produccion()))
  with check ((select puede_editar_produccion()));

drop policy if exists produccion_molino_paradas_select on produccion_molino_paradas;
create policy produccion_molino_paradas_select on produccion_molino_paradas
  for select to authenticated using ((select tiene_acceso_produccion()));

drop policy if exists produccion_molino_paradas_write on produccion_molino_paradas;
create policy produccion_molino_paradas_write on produccion_molino_paradas
  for all to authenticated
  using ((select puede_editar_produccion()))
  with check ((select puede_editar_produccion()));

-- ── 5. El catálogo inicial ───────────────────────────────────
-- `on conflict (clave) do nothing`: correr esto dos veces no pisa un umbral que
-- alguien ya haya movido. `desde` es el día en que esto entra en servicio.

insert into produccion_molinos (clave, nombre, formato, prefijo_archivo, umbral_minutos, desde)
values
  ('filler_1', 'Filler 1',           'filler_1', 'Filler 1', 5, date '2026-10-29'),
  ('filler_2', 'Filler 2 (Calera)',  'filler_2', 'Filler 2', 5, date '2026-10-29')
on conflict (clave) do nothing;

comment on table produccion_molino_turnos is
  'Lo que midió el robot en cada molino, un renglón por turno. Lo escribe la importación y se puede rehacer entera desde el zip; ninguna persona lo edita.';
comment on table produccion_molino_paradas is
  'Por qué un molino no marchó, dicho por una persona. No se rehace desde ningún zip y la importación no la toca. turno null = el día entero (planta parada).';
comment on column produccion_molino_paradas.turno is
  'Null = el día entero. Por eso la unique es `nulls not distinct`: con una común, dos plantas paradas el mismo día pasarían las dos.';
comment on column produccion_molino_turnos.minutos_teoricos is
  'Lo que el turno habría marchado de punta a punta (240 u 480). Cero en un turno huérfano: esa diferencia es lo que lo distingue.';
comment on column produccion_molinos.umbral_minutos is
  'Minutos de diferencia entre marcha y teórica a partir de los que se pide un motivo. Dato y no constante.';
comment on column produccion_molinos.desde is
  'La puesta en servicio: desde acá corre la cola de turnos sin explicar, para que el historial no llegue como una avalancha.';
