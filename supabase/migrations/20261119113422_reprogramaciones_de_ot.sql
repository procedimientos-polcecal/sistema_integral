-- El historial de cada vez que se movió la fecha de inicio de una OT.
--
-- El diseño está en
-- docs/superpowers/specs/2026-11-19-mantenimiento-reprogramacion-y-analisis-de-ot-design.md
-- (sección «El historial» y «Lo que queda a quien lo construya»).
--
-- Una fila por movimiento. Las escribe sólo el cliente admin de las rutas: la
-- ruta `postergar` (origen 'sistema') y la sincronización de OT cuando
-- `contrastar()` ya decidió que la planilla movió la fecha de verdad (origen
-- 'planilla'). No hay policy de insert/update/delete a propósito.
--
-- DOS DECISIONES QUE NO SE DEDUCEN DE LAS COLUMNAS
--
-- 1. `razon` NO lleva foreign key a `mant_razones_de_postergacion`, y
--    `razon_etiqueta` guarda una COPIA del texto hecha al escribir. Esa tabla
--    es configuración que se edita desde Mantenimiento → Configuración, o sea
--    que una razón se puede retirar o renombrar. Con FK, retirarla se vuelve
--    imposible o se lleva el historial por delante; sin FK y sin copia, la
--    pantalla tendría que mostrar un código que ya no resuelve a nada. La copia
--    hace que una reprogramación siga diciendo lo que decía el día que se hizo,
--    que es lo que se consulta. El `codigo` se guarda igual, para agrupar.
--
-- 2. EL CONTADOR `reprogramada_veces` VA POR TRIGGER Y NO POR CÓDIGO DE LA
--    APLICACIÓN. Un contador que escriben dos rutas es un valor en dos lugares
--    que nada ata —la trampa del 27 del GUT, que allá se resolvió con un test
--    que los ata y que acá ningún test puede atar, porque el otro lado del
--    cable es Postgres—. Un trigger no se puede olvidar. Existe como columna
--    para que el filtro «reprogramadas» corra sobre las 2.531 órdenes y no
--    sobre una página: un `.in()` con muchos ids arma una URL que PostgREST
--    rechaza con un 400 mudo. El upsert de la sincronización no la pisa:
--    PostgREST sólo escribe las columnas del payload y `paraLaBase()` no la
--    incluye.
--
--    El trigger RECUENTA en vez de sumar o restar uno: así un contador que
--    alguna vez quedó torcido se corrige solo con la siguiente fila, y el
--    cascade de un borrado de OT (que dispara el trigger sobre una orden que
--    ya no está) no actualiza ninguna fila y no falla.
--
-- No toca ningún enum, así que no hay 55P04 que esquivar.

-- ── 1. LA TABLA ─────────────────────────────────────────────────────────────
create table if not exists public.mant_reprogramaciones_ot (
  id             uuid primary key default gen_random_uuid(),
  ot_id          uuid not null references public.ordenes_trabajo(id) on delete cascade,
  fecha_anterior date,
  -- Not null: una fecha que se vacía no es una reprogramación y no crea fila.
  fecha_nueva    date not null,
  origen         text not null check (origen in ('sistema', 'planilla')),
  razon          text,
  razon_etiqueta text,
  justificacion  text,
  creado_por     uuid references public.usuarios(id),
  creado_en      timestamptz not null default now()
);

comment on table public.mant_reprogramaciones_ot is
  'Cada vez que se movió la fecha de inicio de una OT. origen sistema = la '
  'ruta postergar; planilla = la sincronización vio que la J del master cambió. '
  'Dato operativo que lee cualquiera con acceso a Mantenimiento; no reemplaza '
  'a auditoria, que es inmutable y la lee sólo admin_sistema.';
comment on column public.mant_reprogramaciones_ot.razon is
  'Código de mant_razones_de_postergacion. Sin FK a propósito: la razón se '
  'puede retirar o renombrar y el historial no tiene que enterarse.';
comment on column public.mant_reprogramaciones_ot.razon_etiqueta is
  'Copia del texto de la razón hecha al escribir la fila.';

-- Se lee siempre «la última fila de una OT».
create index if not exists mant_reprogramaciones_ot_ot_idx
  on public.mant_reprogramaciones_ot (ot_id, creado_en desc);

-- Para la pestaña semanal.
create index if not exists mant_reprogramaciones_ot_creado_idx
  on public.mant_reprogramaciones_ot (creado_en);

-- ── 2. EL CONTADOR EN LA OT ─────────────────────────────────────────────────
alter table public.ordenes_trabajo
  add column if not exists reprogramada_veces integer not null default 0;

comment on column public.ordenes_trabajo.reprogramada_veces is
  'Cuántas filas tiene la OT en mant_reprogramaciones_ot. Lo mantiene un '
  'trigger; no se escribe desde la aplicación.';

-- ── 3. EL TRIGGER QUE LO MANTIENE ───────────────────────────────────────────
create or replace function public.mant_contar_reprogramaciones()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ot uuid;
begin
  v_ot := case when tg_op = 'DELETE' then old.ot_id else new.ot_id end;

  update public.ordenes_trabajo
     set reprogramada_veces = (
       select count(*)::integer
         from public.mant_reprogramaciones_ot
        where ot_id = v_ot
     )
   where id = v_ot;

  return null;
end;
$$;

drop trigger if exists mant_reprogramaciones_ot_contar
  on public.mant_reprogramaciones_ot;

create trigger mant_reprogramaciones_ot_contar
  after insert or delete on public.mant_reprogramaciones_ot
  for each row execute function public.mant_contar_reprogramaciones();

-- ── 4. PERMISOS ─────────────────────────────────────────────────────────────
alter table public.mant_reprogramaciones_ot enable row level security;

-- ENVUELTA: `(select mant_puede_ver())` y no `mant_puede_ver()`. Pelada no
-- rompe nada y no avisa, y la tabla pasa a costar proporcional a sus filas —
-- ver 20261014090512. Insert/update/delete: ninguna policy, escribe sólo el
-- cliente admin de las rutas.
create policy mant_reprogramaciones_ot_leer
  on public.mant_reprogramaciones_ot
  for select to authenticated
  using ((select mant_puede_ver()));
