-- Quiénes trabajaron en el parte diario, guardado.
--
-- POR QUÉ EXISTE
--
-- El parte diario tenía un campo «Operario» que era texto libre, uno solo, y
-- que **no se guardaba**: vivía mientras la pantalla estaba abierta y se perdía
-- al recargar. Se pidió poder anotar varios y que el dato quede, para que
-- mañana se sepa quién estuvo. Los nombres salen del padrón del taller
-- (`mant_personal_taller`), que es la misma gente que la programación semanal
-- reparte por turno: eso es lo que hace que la programación y el parte dejen de
-- ser dos listas separadas.
--
-- LA CLAVE SON LOS TRES JUNTOS, Y EL TURNO ES PARTE DE ELLA
--
-- Un plan se imprime más de una vez: la hoja de 4 a 12 y la de 12 a 20 son dos
-- papeles del mismo día. Si la clave fuera (plan, empleado), cargar el segundo
-- turno pisaría al primero. Con el turno adentro, cada hoja tiene su equipo y
-- ninguna pisa a la otra.
--
-- `todo_el_dia` es un turno más y NO es «los dos». Guardarlo como los dos haría
-- que, al corregir después quién estuvo de 12 a 20, nadie pueda decir si esa
-- persona venía del turno o del día entero.
--
-- Los dos valores de turno restantes son los de **Producción**
-- (`lib/produccion/turnos.ts`: `4_12` y `12_20`) y no los tres del taller
-- (`4-12`, `8-16`, `12-20`): el papel del parte diario tiene preimpresos esos
-- dos, y dos vocabularios para lo mismo ya hizo que una OT creada desde la app
-- dejara de aparecer al filtrar. El electricista de 8 a 16 puede figurar igual
-- en cualquiera de las dos hojas —se confirmó que en el papel pasa—, y por eso
-- la pantalla lo ofrece aunque su turno no esté en esta lista.
--
-- EL CHECK VA ACÁ Y NO ES UN ENUM
--
-- Un enum nuevo obliga a que el valor viaje en su propio archivo (`55P04`) y a
-- una migración más cada vez que se agregue un turno. Un `check` sobre texto
-- hace lo mismo para tres valores que no cambian seguido, y se corrige con un
-- `drop constraint` + `add constraint` en una sola migración.
--
-- LA UNICIDAD ES UNA CONSTRAINT Y NO UN ÍNDICE PARCIAL
--
-- Esta tabla es destino de un `ON CONFLICT`: guardar el equipo de una hoja es
-- un upsert. Un `create unique index … where …` no sirve ahí y falla recién en
-- el primer upsert, cuando ya nadie mira la migración — pasó tres veces en esta
-- base (README de migraciones). Las tres columnas son `not null`, así que una
-- constraint común alcanza.

create table if not exists planificacion_diaria_operarios (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references planificacion_diaria(id) on delete cascade,

  -- Los dos del papel más el día entero. Ver el encabezado.
  turno       text not null
              check (turno in ('4_12', '12_20', 'todo_el_dia')),

  -- Apunta a `empleados`, que es catálogo del núcleo y se lee, no se rehace.
  -- No apunta a `mant_personal_taller`: la pantalla ofrece a los del taller,
  -- pero una vez guardado lo que importa es la persona, y sacarla del padrón
  -- —que ahora se puede— no tiene por qué borrar de quién fue un parte de hace
  -- tres meses.
  empleado_id uuid not null references empleados(id),

  creado_por  uuid references usuarios(id),
  creado_el   timestamptz not null default now(),

  constraint planificacion_diaria_operarios_unico
    unique (plan_id, turno, empleado_id)
);

-- Para traer el equipo de una hoja sin recorrer la tabla.
create index if not exists pdo_plan_turno_idx
  on planificacion_diaria_operarios (plan_id, turno);

alter table planificacion_diaria_operarios enable row level security;

-- Espeja a `planificacion_diaria`: se ve con `mant_puede_ver()` y se escribe
-- con `puede_editar_mantenimiento()`. Las dos **envueltas en un subselect**:
-- sin eso Postgres evalúa la función una vez por fila aunque sea STABLE, y la
-- tabla empieza a costar proporcional a sus filas sin que nada avise.
-- `mant_puede_ver` declara un argumento con DEFAULT y se llama con paréntesis
-- vacíos, que es justo el caso que una búsqueda por `pronargs = 0` deja afuera.
drop policy if exists pdo_select on planificacion_diaria_operarios;
create policy pdo_select on planificacion_diaria_operarios
  for select to authenticated using ((select mant_puede_ver()));

drop policy if exists pdo_write on planificacion_diaria_operarios;
create policy pdo_write on planificacion_diaria_operarios
  for all to authenticated
  using ((select puede_editar_mantenimiento()))
  with check ((select puede_editar_mantenimiento()));

comment on table planificacion_diaria_operarios is
  'Quiénes trabajaron en cada hoja del parte diario. La clave es (plan, turno, empleado): un plan tiene una hoja por turno y «todo_el_dia» es un turno más, no los dos juntos.';
