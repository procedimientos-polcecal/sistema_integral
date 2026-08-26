-- ============================================================
-- SdG — Cuándo se actualizó lo que viene de una planilla
--
-- Buena parte de lo que muestra el sistema no se carga acá: es el espejo de una
-- planilla que se sincroniza cada tanto. Sin saber cuándo fue la última vez,
-- quien mira no puede distinguir "no hay nada" de "todavía no llegó" — y si la
-- sincronización falló, la pantalla se ve igual que si hubiera salido bien.
--
-- Compras ya lo registra en compras_sincronizaciones desde el principio, con
-- columnas propias y el historial real de un módulo en producción. Esa tabla no
-- se toca: la vista de abajo las une para leer, que es todo lo que hace falta.
-- ============================================================

create table if not exists sincronizaciones (
  id         uuid primary key default gen_random_uuid(),
  modulo     text not null,               -- mantenimiento, rrhh, remises…
  -- Qué se sincronizó dentro del módulo: avisos, ordenes, ordenes-servicio…
  -- Genérico desde el principio porque son cuatro hoy y van a ser más.
  recurso    text not null,
  ok         boolean not null default true,
  error      text,
  filas      integer not null default 0,
  created_at timestamptz not null default now()
);

-- Se consulta siempre por lo último de cada recurso.
create index if not exists sincronizaciones_recurso_idx
  on sincronizaciones (modulo, recurso, created_at desc);

alter table sincronizaciones enable row level security;

-- Leer, cualquiera con sesión: es un dato de la pantalla, no del negocio.
create policy sincronizaciones_select on sincronizaciones
  for select to authenticated using (true);

-- Escribir, sólo el cliente admin desde las rutas de sincronización.
-- Sin política de insert, nadie más puede.

-- ── La última corrida de cada cosa ──────────────────────────
--
-- Une las dos fuentes para que la pantalla consulte un solo lugar sin importar
-- de qué módulo sea. `security_invoker` para que respete RLS como cualquier
-- tabla: sin eso una vista es un agujero por el que se filtra lo que RLS tapa.
create or replace view ultima_sincronizacion
with (security_invoker = true) as
  select distinct on (modulo, recurso)
    modulo, recurso, ok, error, created_at
  from (
    select modulo, recurso, ok, error, created_at from sincronizaciones
    union all
    -- Compras habla de "importar" y "exportar"; para esto sólo interesa cuándo
    -- se trajo lo de la planilla, que es lo que la pantalla muestra.
    select
      'compras'      as modulo,
      'planilla'     as recurso,
      error is null  as ok,
      error,
      created_at
    from compras_sincronizaciones
    where direccion = 'importar'
  ) todas
  order by modulo, recurso, created_at desc;

comment on view ultima_sincronizacion is
  'La última sincronización de cada recurso, de todos los módulos. Alimenta el '
  'cartel de "Actualizado hace…" de las pantallas que espejan una planilla.';
