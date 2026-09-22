-- ============================================================
-- SdG — Taller Vial: partes diarios de equipos móviles (desde Google Forms)
--
-- Los operarios llenan un Google Form al final del turno ("PARTE DIARIO
-- EQUIPOS MÓVILES", relevado el 22/09/2026): qué equipo usaron, en qué
-- sector trabajaron y en qué horario. El form permite cargar hasta DOS
-- bloques de equipo/sector/horario en una sola respuesta (si contestan "No,
-- hice otra actividad" al primero) — acá van como dos filas, no una, porque
-- cada bloque es una unidad de trabajo independiente.
--
-- Clave natural: (marca_temporal, bloque). El form no permite editar una
-- respuesta ya enviada, así que alcanza con insertar lo nuevo en cada
-- sincronización — nunca hay que pisar una fila vieja (a diferencia de
-- `taller_vial_cargas`, que no tiene clave natural y por eso borra y
-- recarga entero).
--
-- Si "Sector trabajado" es "Destape <yacimiento>" (D1/D6/C1/C3), el import
-- (`lib/tallerVial/importarPartes.ts`) crea además una fila en
-- `cantera_destape` con ese mismo operario/equipo/horas, y guarda su id acá
-- en `destape_id` — para no cargarlo dos veces a mano. Si el equipo o el
-- operario no se pudieron resolver contra los catálogos, el parte se
-- guarda igual (queda visible en `/taller-vial/partes`) pero sin fila en
-- Destape: no se inventa a quién o con qué máquina fue.
-- ============================================================

create table if not exists taller_vial_partes (
  id                        uuid primary key default gen_random_uuid(),
  -- Texto crudo de la columna "Marca temporal" — sólo se usa como clave de
  -- deduplicación, no se interpreta como fecha (para eso está `fecha`).
  marca_temporal            text not null,
  bloque                    smallint not null check (bloque in (1, 2)),
  fecha                     date not null,
  operario_raw              text not null,
  operario_id               uuid references empleados(id) on delete set null,
  equipo_raw                text not null,
  equipo_id                 uuid references equipos(id) on delete set null,
  sector_raw                text not null,
  -- Sólo si sector_raw es "Destape <código>" con un yacimiento válido (D1/D6/C1/C3).
  yacimiento_destape_codigo text,
  hora_inicio               text,
  hora_fin                  text,
  horas                     numeric,
  cargaste_todo             text,
  observaciones             text,
  -- La fila que este bloque generó en cantera_destape, si correspondía y se pudo resolver.
  destape_id                uuid references cantera_destape(id) on delete set null,
  origen                    text not null default 'form_google',
  cargado_en                timestamptz not null default now(),
  unique (marca_temporal, bloque)
);

comment on table taller_vial_partes is
  'Partes diarios de equipos móviles, uno por bloque de trabajo, importados desde el Google Form "PARTE DIARIO EQUIPOS MÓVILES" — lib/tallerVial/importarPartes.ts. Un bloque con sector "Destape <yacimiento>" resuelto genera además una fila en cantera_destape (destape_id).';

create index if not exists taller_vial_partes_fecha_idx on taller_vial_partes (fecha);

alter table taller_vial_partes enable row level security;

-- Sólo lectura para usuarios del módulo: esto no se carga a mano, lo
-- escribe únicamente el cron (service role, sin pasar por RLS) — mismo
-- criterio que taller_vial_cargas antes de que se pudiera cargar desde el
-- SdG. Si algún día hace falta corregir un parte a mano, se corrige desde
-- la pantalla de Destape (que ya tiene PATCH/DELETE), no acá.
drop policy if exists taller_vial_partes_select on taller_vial_partes;
create policy taller_vial_partes_select on taller_vial_partes
  for select to authenticated using (tiene_acceso_taller_vial());

notify pgrst, 'reload schema';
