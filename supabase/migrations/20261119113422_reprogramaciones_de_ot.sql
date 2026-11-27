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
-- EL ORDEN DE LAS SECCIONES NO ES DECORATIVO. El `alter table` sobre
-- `ordenes_trabajo` va ANTES del `create table` que la referencia. Un `create
-- table ... references ordenes_trabajo` toma un ShareRowExclusiveLock sobre
-- ella; un `alter table ... add column` posterior en la misma transacción pide
-- AccessExclusiveLock sobre la misma tabla, que es subir de nivel un candado
-- que uno mismo ya tiene y puede terminar en deadlock (40P01) contra cualquier
-- otra transacción que la esté leyendo. Con el alter primero se toma el
-- candado fuerte una sola vez y la foreign key lo encuentra ya tomado. Es la
-- trampa del README de migraciones; el mecanismo completo está en el
-- encabezado de 20260911103029_facturacion_el_detalle_de_la_factura.sql.
-- No lo «ordenes» de vuelta tabla-primero.
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
--    El trigger RECUENTA en vez de sumar o restar uno, así un contador torcido
--    se corrige con la siguiente fila, y el cascade de un borrado de OT (que
--    dispara el trigger sobre una orden que ya no está) no actualiza ninguna
--    fila y no falla. Pero recontar solo NO alcanza con dos inserciones
--    simultáneas sobre la misma OT: el UPDATE de la segunda espera la fila
--    bloqueada por la primera, y al retomar, en READ COMMITTED, vuelve a
--    comprobar la fila pero evalúa el subselect del `set` con la foto que ya
--    tenía, que no incluye la fila de la primera: el contador podía quedar en
--    1 con dos filas. Por eso el trigger toma antes el candado de la fila de
--    la OT: la sentencia siguiente arranca con el candado ya tomado y ve lo
--    que confirmó la otra transacción.
--
--    EL CANDADO ES `for no key update` Y NO `for update`, y no se lo debe
--    «reforzar». El INSERT dispara antes el trigger de integridad de la foreign
--    key de `ot_id`, que ya tomó `for key share` sobre la fila de la OT (los
--    triggers after-row corren en orden de nombre y `RI_ConstraintTrigger_…`
--    va antes que `mant_reprogramaciones_ot_contar`). `for update` choca con
--    `for key share`: dos altas simultáneas para la misma OT quedarían cada una
--    con su key share esperando el `for update` de la otra, o sea deadlock
--    (40P01) y un `postergar` abortado. `for no key update` no choca con key
--    share, pero sí con otro `for no key update` y con el UPDATE de abajo, que
--    es la serialización que hace falta. (El precedente de 046_inventario_schema
--    toma `for update` sin problema porque lo hace ANTES de insertar la fila
--    que referencia; acá el key share de la FK se toma sí o sí primero, dentro
--    de la misma sentencia.)
--
--    Si un UPDATE mueve `ot_id` (el admin puede, aunque ninguna ruta lo hace)
--    se recuentan las dos OT. Se bloquean en orden de id, y eso ordena sólo
--    los dos ids de UNA ejecución del trigger: un insert de varias filas
--    dispara el trigger una vez por fila y bloquea en el orden en que vienen,
--    así que dos cargas masivas simultáneas sobre OT repetidas en distinto
--    orden aún podrían interbloquearse. Ninguna ruta hace hoy esa carga.
--
-- No toca ningún enum, así que no hay 55P04 que esquivar. Se puede correr dos
-- veces: todo lleva `if not exists`, `create or replace` o `drop ... if
-- exists`.

-- ── 1. EL CONTADOR EN LA OT (primero: ver el encabezado) ────────────────────
alter table public.ordenes_trabajo
  add column if not exists reprogramada_veces integer not null default 0;

comment on column public.ordenes_trabajo.reprogramada_veces is
  'Cuántas filas tiene la OT en mant_reprogramaciones_ot. Lo mantiene un '
  'trigger; no se escribe desde la aplicación.';

-- ── 2. LA TABLA ─────────────────────────────────────────────────────────────
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

-- ── 3. EL TRIGGER QUE MANTIENE EL CONTADOR ──────────────────────────────────
create or replace function public.mant_contar_reprogramaciones()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  -- Las OT que hay que recontar: la de la fila que entra o sale y, si el
  -- UPDATE movió `ot_id`, también la de la que se va.
  if tg_op = 'DELETE' then
    v_ids := array[old.ot_id];
  elsif tg_op = 'UPDATE' then
    v_ids := array[new.ot_id, old.ot_id];
  else
    v_ids := array[new.ot_id];
  end if;

  -- Candado de fila ANTES del recuento: la sentencia que sigue toma su foto
  -- con el candado ya tomado y ve lo que confirmó la otra transacción (ver el
  -- encabezado, punto 2). Es `no key update` y NO `update` a propósito: la FK
  -- ya tomó `key share` sobre esta fila antes de que corra este trigger, y
  -- `for update` choca con él y da deadlock entre dos altas de la misma OT.
  -- El `order by id` ordena sólo los ids de esta ejecución. Si la OT ya no
  -- existe (cascade de un borrado) no bloquea nada y el update de abajo no
  -- toca ninguna fila.
  perform 1
     from public.ordenes_trabajo
    where id = any (v_ids)
    order by id
      for no key update;

  update public.ordenes_trabajo o
     set reprogramada_veces = (
       select count(*)::integer
         from public.mant_reprogramaciones_ot r
        where r.ot_id = o.id
     )
   where o.id = any (v_ids);

  return null;
end;
$$;

drop trigger if exists mant_reprogramaciones_ot_contar
  on public.mant_reprogramaciones_ot;

create trigger mant_reprogramaciones_ot_contar
  after insert or delete or update of ot_id on public.mant_reprogramaciones_ot
  for each row execute function public.mant_contar_reprogramaciones();

-- ── 4. PERMISOS ─────────────────────────────────────────────────────────────
alter table public.mant_reprogramaciones_ot enable row level security;

-- ENVUELTA: `(select mant_puede_ver())` y no `mant_puede_ver()`. Pelada no
-- rompe nada y no avisa, y la tabla pasa a costar proporcional a sus filas —
-- ver 20261014090512. Insert/update/delete: ninguna policy, escribe sólo el
-- cliente admin de las rutas. El `drop` previo es para que una segunda corrida
-- no aborte con 42710.
drop policy if exists mant_reprogramaciones_ot_leer
  on public.mant_reprogramaciones_ot;

create policy mant_reprogramaciones_ot_leer
  on public.mant_reprogramaciones_ot
  for select to authenticated
  using ((select mant_puede_ver()));
