-- Lo que hace falta para que una OT periódica se cree sola y se pueda postergar.
--
-- El diseño está en
-- docs/superpowers/specs/2026-10-29-mantenimiento-ot-periodicas-y-reprogramacion-design.md
-- y el plan en docs/superpowers/plans/2026-10-29-mantenimiento-ot-periodicas.md
--
-- Son tres cosas y van juntas en un archivo a propósito: las corre una persona
-- a mano, y pedirle tres veces lo mismo es cómo se aplica una y se olvidan dos.
-- Ninguna de las tres toca un enum, así que no hay 55P04 que esquivar.

-- ── 1. LA FECHA QUE TODAVÍA NO LLEGÓ AL MASTER ──────────────────────────────
--
-- La fecha de ejecución de una OT es la columna J del master, y esa columna es
-- derrame de un `QUERY(IMPORTRANGE())`: escribir ahí no queda. Se escribe en
-- «Altas del sistema» —columna FECHA COMPROMETIDA, índice 26— y el derrame
-- tarda en llegar: las cinco OT medidas el 21/10/2026 tardaron **de 3 a 53
-- horas**.
--
-- En esa ventana `sincronizarOrdenes` leería la J vieja y pisaría la fecha
-- nueva, y `contrastar` contaría la diferencia como divergencia — disparando
-- además el push de `mant-divergencias`, que es justo lo contrario de lo que
-- se quiere. Mientras esta columna tenga valor, la importación no pisa esa
-- fecha y el contraste la trata como algo en camino. Se limpia sola cuando la
-- J del master llega a ese valor.
--
-- POR QUÉ NO SE REUSA `sheets_pendiente`, que ya hace algo parecido: la cola
-- rearma el registro desde la fila con `loQueHayQueExportar`, que sólo sabe de
-- estado, cierre, horas, contratista y operarios. Un pendiente que esa función
-- no puede rehacer **se limpia solo en el primer drenaje** —está explicado en
-- lib/mantenimiento/pendienteDeLaOT.ts— y dejaría la OT desprotegida sin que
-- nada lo dijera.
alter table public.ordenes_trabajo
  add column if not exists fecha_ejecucion_pendiente date;

comment on column public.ordenes_trabajo.fecha_ejecucion_pendiente is
  'Fecha de ejecución escrita en «Altas del sistema» que el derrame del master '
  'todavía no reflejó. Mientras no sea nula, la importación no pisa '
  'fecha_ejecucion y el contraste no la cuenta como divergencia.';

-- ── 2. LA ESPECIALIDAD DEL PROGRAMADO ───────────────────────────────────────
--
-- `loQueFaltaParaCrear` exige especialidad desde el 19/10/2026, y
-- `especialidadDeTipo` sólo la resuelve con certeza para dos de los siete
-- tipos de mantenimiento: Lubricacion y Revision_electrica. Para Inspeccion,
-- Limpieza, Ajuste, Reemplazo y Otro devuelve vacío **a propósito**, porque
-- enlazar al que se le parece es peor que dejar en null — un "Ajuste" mandado
-- como MECÁNICO queda en el filtro equivocado y eso no se nota nunca.
--
-- Mientras una persona completaba el formulario eso estaba bien: la pantalla
-- preguntaba. Un cron no tiene a quién preguntarle, así que el programado
-- necesita poder traerla puesta. Nace en null y el programado que la tenga
-- vacía simplemente no genera, y se informa.
alter table public.mantenimientos_programados
  add column if not exists especialidad text;

comment on column public.mantenimientos_programados.especialidad is
  'La especialidad de las OT que genera este programado. En null, si el tipo '
  'de mantenimiento no la resuelve solo, el programado no genera nada.';

-- ── 3. LAS RAZONES POR LAS QUE SE POSTERGA ──────────────────────────────────
--
-- Qué razones se ofrecen y cuántos días sugiere cada una. El código conoce los
-- `codigo` —de cada uno va a colgar una comprobación el día que la
-- postergación automática entre— y esta tabla decide cuáles están activas y
-- con cuántos días. O sea: el menú no inventa razones, las calibra.
create table if not exists public.mant_razones_de_postergacion (
  codigo    text primary key,
  etiqueta  text    not null,
  dias      integer not null check (dias > 0),
  activa    boolean not null default true,
  orden     integer not null default 0
);

alter table public.mant_razones_de_postergacion enable row level security;

-- LAS POLICIES VAN ENVUELTAS: `using ((select mant_puede_ver()))` y no
-- `using (mant_puede_ver())`. Postgres evalúa el USING una vez por fila aunque
-- la función sea STABLE; el subselect lo vuelve un InitPlan que se evalúa una
-- sola vez. Pelada no rompe nada y no avisa — ver 20261014090512.
create policy mant_razones_de_postergacion_leer
  on public.mant_razones_de_postergacion
  for select to authenticated
  using ((select mant_puede_ver()));

create policy mant_razones_de_postergacion_escribir
  on public.mant_razones_de_postergacion
  for all to authenticated
  using ((select puede_editar_mantenimiento()))
  with check ((select puede_editar_mantenimiento()));

-- La única acordada con número: 3 días, decidida el 29/10/2026. Las demás las
-- carga quien use el menú.
insert into public.mant_razones_de_postergacion (codigo, etiqueta, dias, activa, orden)
values ('falta_repuesto', 'Falta de repuesto en planta', 3, true, 1)
on conflict (codigo) do nothing;
