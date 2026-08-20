-- ============================================================
-- SdG — Compras: alias de cada aprobador en la planilla
--
-- La columna de aprobación del master tiene una lista desplegable estricta:
--
--   APROBADA (NICO) · APROBADA (MAXI) · DENEGADA · EN REVISIÓN
--
-- Al aprobar desde el sistema se escribía el nombre completo del usuario
-- —"APROBADA (Maximiliano Lenzetti)"—, que no es ninguna de esas opciones. La
-- celda quedaba fuera de la validación y cualquier fórmula o filtro que dependa
-- de esos textos exactos dejaba de contarla.
--
-- Acá se guarda con qué alias figura cada aprobador en la planilla. No se
-- deduce del nombre: "MAXI" no se saca de "Maximiliano" sin adivinar, y
-- adivinar mal escribe un valor inválido en un dato que mira gerencia.
-- ============================================================

create table if not exists compras_aprobadores (
  usuario_id     uuid primary key references usuarios(id) on delete cascade,
  -- Tal cual aparece entre paréntesis en la planilla: NICO, MAXI, …
  alias_planilla text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint alias_no_vacio check (btrim(alias_planilla) <> '')
);

-- Dos personas no pueden compartir alias: la planilla no podría distinguirlas.
create unique index if not exists compras_aprobadores_alias_key
  on compras_aprobadores (upper(btrim(alias_planilla)));

create trigger compras_aprobadores_updated_at
  before update on compras_aprobadores
  for each row execute function set_updated_at();

-- Quién aprobó, como referencia y no como texto suelto: el alias de la planilla
-- se busca por usuario. `aprobador` se conserva porque en los 1825 importados
-- es el único dato que hay (venían como "NICO" o "MAXI", sin usuario detrás).
alter table compras_requerimientos
  add column if not exists aprobado_por uuid references usuarios(id) on delete set null;

create index if not exists compras_req_aprobado_por_idx
  on compras_requerimientos (aprobado_por);

alter table compras_aprobadores enable row level security;

drop policy if exists compras_aprobadores_select on compras_aprobadores;
create policy compras_aprobadores_select on compras_aprobadores
  for select to authenticated using (true);

-- Lo administra quien gestiona compras; define cómo se firma en la planilla.
drop policy if exists compras_aprobadores_write on compras_aprobadores;
create policy compras_aprobadores_write on compras_aprobadores
  for all to authenticated
  using (puede_editar_compras())
  with check (puede_editar_compras());
