-- ============================================================
-- SdG — Mantenimiento: el cuaderno del contratista PIPARO
--
-- PIPARO no entrega partes sueltos como Candia: lleva **un cuaderno
-- manuscrito** donde anota día por día qué hizo, dónde y cuántas horas. Las
-- fotos de sus páginas entran al sistema, un modelo las lee, una persona
-- chequea el resultado en pantalla y de ahí salen las órdenes de trabajo — ver
-- `docs/superpowers/specs/2026-10-30-mantenimiento-cuaderno-de-piparo-design.md`.
--
-- Estas tablas son el papel y su lectura, no la OT. Es la misma decisión que
-- tomó `20261020125508_mantenimiento_partes_de_contratista.sql` y por la misma
-- razón: la conversión a OT **pierde el original**, y mientras el original
-- viva acá se puede volver de la OT a lo que decía la hoja.
--
-- POR QUÉ NO SE REUSAN LAS TABLAS DE LOS PARTES DE CANDIA. Un parte de Candia
-- es una hoja con número preimpreso, una expresión de horas y un total que
-- cierra contra la factura; los renglones de un cuaderno no tienen nada de eso.
-- Meterlos ahí obligaría a inventar un número de hoja y un total declarado, y
-- un dato inventado en una tabla de control es peor que una tabla más.
--
-- POR QUÉ HAY UNA TABLA DE FOTOS. Un cuaderno es varias fotos, y cada una se
-- lee por separado (y puede fallar por separado). Guardar la respuesta cruda
-- del modelo por foto es lo que permite reintentar una sola y saber, después,
-- qué leyó el modelo y qué cambió una persona.
--
-- EL BUCKET `cuaderno-contratista` NACE ACÁ y no a mano en el panel de
-- Supabase: uno creado a mano no queda en el repo y el próximo entorno no lo
-- tiene. Es **privado** a propósito. El cuaderno es un papel interno que nadie
-- mira sin sesión, al revés que la foto de un aviso, que se escribe en una
-- planilla y la mira gente sin login.
--
-- Esta migración sólo crea tablas nuevas y un bucket: las dos columnas que
-- toca el cuaderno en tablas existentes (`ordenes_trabajo.costo`,
-- `proveedores.modo_de_carga`) van en sus propios archivos, así una que falle
-- no arrastra a las otras.
-- ============================================================

-- ── El cuaderno: un lote de fotos de PIPARO ─────────────────
create table if not exists public.mant_cuadernos (
  id           uuid primary key default gen_random_uuid(),
  proveedor_id uuid not null references public.proveedores(id) on delete restrict,
  cargado_por  uuid references public.usuarios(id) on delete set null,

  -- En qué paso del flujo está. Texto y no enum a propósito: un valor de enum
  -- nuevo viaja solo en su propio archivo, y el flujo todavía puede cambiar.
  estado       text not null default 'EN_CHEQUEO',
  created_at   timestamptz not null default now()
);

comment on column public.mant_cuadernos.estado is
  'En qué paso del flujo está el cuaderno. Nace EN_CHEQUEO: una persona tiene que mirar lo que leyó el modelo antes de que salga una sola OT.';

-- ── Las fotos de las páginas ────────────────────────────────
create table if not exists public.mant_cuadernos_fotos (
  id           uuid primary key default gen_random_uuid(),
  cuaderno_id  uuid not null references public.mant_cuadernos(id) on delete cascade,

  -- El orden de las páginas. Importa: lo que una línea hereda de la anterior
  -- (la fecha, el lugar) cruza el borde de la foto.
  orden        integer not null,

  -- El archivo dentro del bucket `cuaderno-contratista`. Es la ruta y no un
  -- link: el bucket es privado y el link se firma al pedirlo.
  ruta         text not null,

  respuesta_cruda jsonb,
  fallo        text,
  created_at   timestamptz not null default now()
);

comment on column public.mant_cuadernos_fotos.respuesta_cruda is
  'Lo que dijo el modelo, sin tocar. Es lo único que distingue «lo leyó mal» de «lo editó una persona»: los renglones se corrigen en pantalla y esto no.';

comment on column public.mant_cuadernos_fotos.fallo is
  'Lo que falló al leer esta foto, tal como vino y sin traducir. Null si salió bien. Una foto que falla no tira el cuaderno entero: se reintenta sola.';

create index if not exists mant_cuadernos_fotos_cuaderno_idx
  on public.mant_cuadernos_fotos (cuaderno_id);

-- ── Los renglones leídos ────────────────────────────────────
create table if not exists public.mant_cuadernos_renglones (
  id           uuid primary key default gen_random_uuid(),
  cuaderno_id  uuid not null references public.mant_cuadernos(id) on delete cascade,

  -- De qué foto salió, para poder mirar el renglón al lado del papel. Si la
  -- foto se borra el renglón queda: ya es un dato chequeado.
  foto_id      uuid references public.mant_cuadernos_fotos(id) on delete set null,

  -- El número de línea en la página, tal como lo vio el modelo.
  linea        integer,
  fecha        date,

  -- Qué se hizo, tal como está escrito.
  tarea        text not null,

  -- El lugar **tal como lo escribió PIPARO**. Se guarda crudo porque es la
  -- prueba de qué decía el papel.
  lugar_raw    text,

  -- El sector al que se enganchó. **NULL es "no se sabe" y se deja en null a
  -- propósito**: enlazar al que se le parece pondría las horas en el centro de
  -- costo equivocado y eso no se nota nunca.
  sector_id    uuid references public.sectores(id) on delete set null,

  -- Si el sector lo propuso el sistema y nadie lo confirmó todavía. Sin esta
  -- marca, una propuesta se vería igual que una respuesta y confirmar sin mirar
  -- se vuelve automático.
  sector_propuesto boolean not null default false,

  -- Y el equipo, cuando el lugar es uno. Una OT no puede nacer sin equipo.
  equipo_id    uuid references public.equipos(id) on delete set null,

  horas        numeric,
  costo        numeric,

  -- Que el modelo no estaba seguro de lo que leyó. Va con su motivo, porque
  -- «dudoso» sin decir de qué no le sirve a quien tiene que chequear.
  dudoso       boolean not null default false,
  motivo_dudoso text,

  -- Que la fecha o el lugar no estaban en esta línea y se tomaron de la
  -- anterior (el cuaderno escribe «ídem» o deja en blanco). Se marca para que
  -- una persona pueda ver qué fue heredado y qué fue leído.
  heredado     boolean not null default false,

  -- Qué renglones salen en la misma OT. Sin fk a nada: es sólo una etiqueta
  -- compartida por los renglones que se agrupan.
  grupo_id     uuid,

  -- A qué OT fue a parar. Es lo que impide generar la misma orden dos veces por
  -- apretar el botón dos veces, y lo que permite volver de la OT al papel.
  orden_trabajo_id uuid references public.ordenes_trabajo(id) on delete set null,

  created_at   timestamptz not null default now()
);

comment on column public.mant_cuadernos_renglones.orden_trabajo_id is
  'La OT que generó este renglón. Mientras esté en null, el renglón todavía no se convirtió; con algo, no se vuelve a generar.';

create index if not exists mant_cuadernos_renglones_cuaderno_idx
  on public.mant_cuadernos_renglones (cuaderno_id);

create index if not exists mant_cuadernos_renglones_grupo_idx
  on public.mant_cuadernos_renglones (grupo_id)
  where grupo_id is not null;

create index if not exists mant_cuadernos_renglones_ot_idx
  on public.mant_cuadernos_renglones (orden_trabajo_id)
  where orden_trabajo_id is not null;

-- ── RLS ─────────────────────────────────────────────────────
--
-- La misma forma que el resto del módulo: ve quien ve Mantenimiento, escribe
-- quien lo edita. Las llamadas van **envueltas en un select**: sin eso Postgres
-- evalúa la función una vez por fila y la tabla empieza a costar proporcional
-- a sus filas. `mant_puede_ver(uid uuid default auth.uid())` declara un
-- argumento pero se llama con los paréntesis vacíos, así que va envuelta igual.
alter table public.mant_cuadernos           enable row level security;
alter table public.mant_cuadernos_fotos     enable row level security;
alter table public.mant_cuadernos_renglones enable row level security;

drop policy if exists mant_cuadernos_select on public.mant_cuadernos;
create policy mant_cuadernos_select on public.mant_cuadernos
  for select to authenticated using ((select public.mant_puede_ver()));

drop policy if exists mant_cuadernos_write on public.mant_cuadernos;
create policy mant_cuadernos_write on public.mant_cuadernos
  for all to authenticated
  using ((select public.mant_puede_editar()))
  with check ((select public.mant_puede_editar()));

drop policy if exists mant_cuadernos_fotos_select on public.mant_cuadernos_fotos;
create policy mant_cuadernos_fotos_select on public.mant_cuadernos_fotos
  for select to authenticated using ((select public.mant_puede_ver()));

drop policy if exists mant_cuadernos_fotos_write on public.mant_cuadernos_fotos;
create policy mant_cuadernos_fotos_write on public.mant_cuadernos_fotos
  for all to authenticated
  using ((select public.mant_puede_editar()))
  with check ((select public.mant_puede_editar()));

drop policy if exists mant_cuadernos_renglones_select on public.mant_cuadernos_renglones;
create policy mant_cuadernos_renglones_select on public.mant_cuadernos_renglones
  for select to authenticated using ((select public.mant_puede_ver()));

drop policy if exists mant_cuadernos_renglones_write on public.mant_cuadernos_renglones;
create policy mant_cuadernos_renglones_write on public.mant_cuadernos_renglones
  for all to authenticated
  using ((select public.mant_puede_editar()))
  with check ((select public.mant_puede_editar()));

-- ── El bucket de las fotos ──────────────────────────────────
--
-- La lista de tipos dice lo mismo que va a decir la ruta de subida: un tipo
-- que la ruta acepta y el bucket no, se ve como un 502 de Storage que no
-- explica nada. `image/heif` NO va; si se suma un tipo, va en los dos lados.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cuaderno-contratista',
  'cuaderno-contratista',
  false,
  10485760,
  array['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

-- Mismas policies que el resto de los buckets del módulo, envueltas igual. El
-- permiso es del módulo entero y no de quien subió la foto.
drop policy if exists cuaderno_contratista_storage_insert on storage.objects;
create policy cuaderno_contratista_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'cuaderno-contratista' and (select public.mant_puede_editar()));

drop policy if exists cuaderno_contratista_storage_select on storage.objects;
create policy cuaderno_contratista_storage_select on storage.objects
  for select to authenticated
  using (bucket_id = 'cuaderno-contratista' and (select public.mant_puede_ver()));

drop policy if exists cuaderno_contratista_storage_delete on storage.objects;
create policy cuaderno_contratista_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'cuaderno-contratista' and (select public.mant_puede_editar()));
