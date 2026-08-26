-- ============================================================
-- SdG — Los sectores de planta, aparte de los organizativos
--
-- `sectores` guarda hoy dos cosas distintas con el mismo nombre: dónde trabaja
-- una persona —"Administración", "Calidad", "Producción (RRHH)"— y dónde está
-- una máquina —"Calcinación", "Filler 2", "Compresores"—. Son taxonomías
-- distintas y las usa gente distinta.
--
-- Se distinguen con una marca en vez de separarse en dos tablas porque los
-- avisos, las órdenes de trabajo y las de servicio ya apuntan a `sectores.id`,
-- y partir la tabla obligaría a rehacer esos enlaces sin ganar nada.
-- ============================================================

alter table sectores
  add column if not exists codigo text,
  add column if not exists es_de_planta boolean not null default false;

-- El código viene del libro "BD Equipos" —PO-A1, PY-B1, AMB-C1— y es lo que
-- permite volver a importarlo sin adivinar por nombre. Único cuando existe:
-- los sectores organizativos no tienen.
create unique index if not exists sectores_codigo_idx
  on sectores (codigo) where codigo is not null;

create index if not exists sectores_de_planta_idx
  on sectores (es_de_planta) where es_de_planta;

comment on column sectores.codigo is
  'El código del sector en el libro BD Equipos (PO-A1, PY-B1, AMB-C1). Sólo los sectores de planta lo tienen.';
comment on column sectores.es_de_planta is
  'Dónde está una máquina, no dónde trabaja una persona. Mantenimiento usa éstos; RRHH y Remises, los otros.';
