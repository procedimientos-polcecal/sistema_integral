-- ============================================================
-- SdG — Mantenimiento: los partes diarios del contratista
--
-- Candia entrega **quince partes diarios en papel cada quince días**. Hoy no
-- se cargan en ningún lado: se miran, se aprueba la factura y se archivan. El
-- SdG no sabe qué se le hizo a cada sector ni cuántas horas se pagaron por
-- actividad, así que no hay con qué controlar la factura.
--
-- Estas tres tablas son el papel, no la OT. Las OT salen de acá agrupando por
-- semana, actividad y sector — ver
-- `docs/superpowers/specs/2026-10-20-mantenimiento-partes-de-contratista-design.md`.
--
-- POR QUÉ UNA TABLA Y NO UNA OT POR PARTE. Un parte es un día de dos o tres
-- personas repartido entre cinco frentes de trabajo; una OT es un trabajo en
-- un sector. Son granularidades distintas y la conversión **pierde el
-- original**: si el papel sólo viviera como OT, la suma de horas de la
-- quincena ya no se podría comparar contra lo que Candia escribió, que es
-- justamente para lo que existe esto.
-- ============================================================

-- ── El parte: una fila por hoja de papel ────────────────────
create table if not exists public.mant_partes_contratista (
  id          uuid primary key default gen_random_uuid(),
  proveedor_id uuid not null references public.proveedores(id) on delete restrict,

  -- El número preimpreso de la hoja. **Son correlativos** —1301, 1302, 1303—,
  -- así que un salto o un repetido se detecta solo. Único por proveedor y no
  -- global: dos contratistas tienen sus propias series y van a chocar.
  numero      integer not null,
  fecha       date    not null,

  -- A quién va dirigida la hoja ("a los Sres.: FRANCISCO VARELA"). Texto libre
  -- a propósito: es lo que dice el papel, no un enlace a `usuarios`.
  dirigido_a  text,

  -- Las horas de entrada y salida, tal como están escritas ("08H", "16H"). No
  -- entran en ninguna cuenta: las horas que se pagan salen de la expresión de
  -- abajo, que es otra cosa —son personas × horas, no un rango—.
  hora_entrada text,
  hora_salida  text,

  -- La expresión de horas normales, **tal como está escrita en el papel**:
  -- "2 P. x 8H + 1 P. x 2H". Se guarda el texto y no sólo el total porque es
  -- de donde sale el reparto: el segundo término es siempre el riego.
  horas_expresion text not null,

  -- El total que Candia escribió a mano en la casilla "HORAS". Es contra esto
  -- que cierra la suma de los renglones, y es el control de la factura: sin
  -- él esto sería sólo transcribir.
  horas_declaradas numeric not null,

  -- Están en el papel y hoy vienen vacías en las tres hojas medidas. Se
  -- guardan porque están; **no entran en el reparto**. El día que aparezcan
  -- hay que decidir si son otra OT o un recargo de la misma.
  horas_50  numeric,
  horas_100 numeric,

  materiales text,

  cargado_por uuid references public.usuarios(id) on delete set null,
  created_at  timestamptz not null default now(),

  unique (proveedor_id, numero)
);

comment on column public.mant_partes_contratista.horas_expresion is
  'La suma tal como está escrita en el papel. El SEGUNDO TÉRMINO ES SIEMPRE EL RIEGO y el primero se reparte entre los demás renglones; por eso se guarda el texto y no sólo el total.';

comment on column public.mant_partes_contratista.horas_declaradas is
  'El total escrito a mano. La suma de las horas de los renglones tiene que dar esto: es el control de la factura.';

create index if not exists mant_partes_contratista_fecha_idx
  on public.mant_partes_contratista (fecha);

-- ── Los renglones del detalle ───────────────────────────────
create table if not exists public.mant_partes_contratista_renglones (
  id        uuid primary key default gen_random_uuid(),
  parte_id  uuid not null references public.mant_partes_contratista(id) on delete cascade,

  -- En qué orden está escrito en el papel. Importa: el reparto depende de
  -- cuántos renglones hay, y leer el parte al lado de la hoja pide el mismo
  -- orden.
  orden integer not null,

  -- Qué se hizo. Hoy son dos —limpieza y riego— pero es texto y no un enum a
  -- propósito: el enum de un vocabulario que todavía no se conoce obliga a una
  -- migración por cada palabra nueva que Candia escriba, y un valor de enum
  -- nuevo acá viaja solo en su propio archivo.
  actividad text not null,

  -- El lugar **tal como lo escribió Candia**: "Molino horizontal", "Bajo
  -- cintas", "Caja E". Se guarda crudo porque es la prueba de qué decía el
  -- papel, y porque es la clave con la que aprende el catálogo de abajo.
  lugar_raw text not null,

  -- El sector al que se enganchó. **NULL es "no se sabe" y se deja en null a
  -- propósito**: enlazar al que se le parece pondría las horas en el centro de
  -- costo equivocado y eso no se nota nunca.
  sector_id uuid references public.sectores(id) on delete set null,

  -- Y el equipo, cuando el lugar es uno. **La mayoría lo son**: "Horno N°1",
  -- "Molino horizontal", "Balanza" y "Bandejas" son máquinas, no zonas. Hace
  -- falta porque una OT no puede nacer sin equipo —`loQueFaltaParaCrear` lo
  -- exige desde el 19/10/2026, y de ahí viven el MTBF y la ficha de la
  -- máquina—, y porque sin esto la limpieza de un horno quedaría contada
  -- contra el sector entero.
  equipo_id uuid references public.equipos(id) on delete set null,

  -- Las horas que le tocaron del reparto. Se guardan calculadas y no se
  -- recalculan al leer: el reparto depende de la expresión y de cuántos
  -- renglones había **ese día**, y editar un parte viejo no tiene por qué
  -- mover las horas de una OT ya generada.
  horas numeric not null,

  -- A qué OT fue a parar. Es lo que impide generar veinte órdenes dos veces
  -- por apretar el botón dos veces, y lo que permite volver de la OT al papel.
  orden_trabajo_id uuid references public.ordenes_trabajo(id) on delete set null,

  created_at timestamptz not null default now()
);

comment on column public.mant_partes_contratista_renglones.horas is
  'Las horas que el reparto le dio a este renglón. Son una CONVENCIÓN, no una medición: nadie contó cuánto llevó cada frente. No se redondean — redondear rompe que la quincena cierre contra la factura.';

comment on column public.mant_partes_contratista_renglones.orden_trabajo_id is
  'La OT que generó este renglón. Mientras esté en null, el renglón todavía no se convirtió; con algo, no se vuelve a generar.';

create index if not exists mant_partes_renglones_parte_idx
  on public.mant_partes_contratista_renglones (parte_id);

-- Para "¿qué falta generar?" y para volver de la OT al papel.
create index if not exists mant_partes_renglones_sin_ot_idx
  on public.mant_partes_contratista_renglones (parte_id)
  where orden_trabajo_id is null;

create index if not exists mant_partes_renglones_ot_idx
  on public.mant_partes_contratista_renglones (orden_trabajo_id)
  where orden_trabajo_id is not null;

-- ── El catálogo de equivalencias ────────────────────────────
--
-- El detalle viene en el idioma de Candia y no en el del catálogo: *molino
-- horizontal* es el molino de Molienda de cal, y *bajo cintas* son las cintas
-- transportadoras de la Planta de trituración 3. **Ninguno de los dos se
-- deduce del texto** — los dos los contestó una persona.
--
-- Así que esto no adivina: guarda lo que alguien ya contestó una vez. La
-- primera quincena son unos quince nombres; después, casi ninguno.
create table if not exists public.mant_contratista_lugares (
  id           uuid primary key default gen_random_uuid(),
  proveedor_id uuid not null references public.proveedores(id) on delete cascade,

  -- El texto normalizado —minúsculas, sin acentos, espacios colapsados— que es
  -- la clave de búsqueda. Lo normaliza la aplicación y no la base: la misma
  -- función tiene que correr al buscar y al guardar, y en el código hay una
  -- sola. Ver `lib/mantenimiento/partesDeContratista.ts`.
  texto text not null,
  -- Cómo estaba escrito la primera vez, para poder mostrarlo.
  texto_original text not null,

  sector_id uuid not null references public.sectores(id) on delete cascade,

  -- El equipo, si el lugar es uno. Opcional: "bajo cintas" es un sector entero
  -- y "Horno N°1" es una máquina, y las dos cosas aparecen en el mismo papel.
  equipo_id uuid references public.equipos(id) on delete set null,

  -- Quién lo enseñó y cuándo. Un enganche equivocado se arrastra a todas las
  -- quincenas siguientes, así que tiene que poder preguntársele a alguien.
  --
  -- Sin eñe aunque todo el resto esté en castellano: **ninguna columna del
  -- sistema la tiene**, y un identificador con eñe hay que citarlo en cada
  -- consulta de SQL suelto. El nombre vale menos que no dejar esa trampa.
  cargado_por uuid references public.usuarios(id) on delete set null,
  created_at   timestamptz not null default now(),

  unique (proveedor_id, texto)
);

-- ── RLS ─────────────────────────────────────────────────────
--
-- Las tres con la misma forma que el resto del módulo: ve quien ve
-- Mantenimiento, escribe quien lo edita. Las llamadas van **envueltas en un
-- select** por la regla de las policies: sin eso Postgres evalúa la función
-- una vez por fila y la tabla empieza a costar proporcional a sus filas.
-- `mant_puede_ver(uid uuid default auth.uid())` declara un argumento pero se
-- llama con los paréntesis vacíos, así que va envuelta igual — es la trampa
-- que dejó 22 policies afuera en la primera pasada del 14/10/2026.
alter table public.mant_partes_contratista            enable row level security;
alter table public.mant_partes_contratista_renglones  enable row level security;
alter table public.mant_contratista_lugares           enable row level security;

drop policy if exists mant_partes_contratista_select on public.mant_partes_contratista;
create policy mant_partes_contratista_select on public.mant_partes_contratista
  for select to authenticated using ((select public.mant_puede_ver()));

drop policy if exists mant_partes_contratista_write on public.mant_partes_contratista;
create policy mant_partes_contratista_write on public.mant_partes_contratista
  for all to authenticated
  using ((select public.mant_puede_editar()))
  with check ((select public.mant_puede_editar()));

drop policy if exists mant_partes_renglones_select on public.mant_partes_contratista_renglones;
create policy mant_partes_renglones_select on public.mant_partes_contratista_renglones
  for select to authenticated using ((select public.mant_puede_ver()));

drop policy if exists mant_partes_renglones_write on public.mant_partes_contratista_renglones;
create policy mant_partes_renglones_write on public.mant_partes_contratista_renglones
  for all to authenticated
  using ((select public.mant_puede_editar()))
  with check ((select public.mant_puede_editar()));

drop policy if exists mant_contratista_lugares_select on public.mant_contratista_lugares;
create policy mant_contratista_lugares_select on public.mant_contratista_lugares
  for select to authenticated using ((select public.mant_puede_ver()));

drop policy if exists mant_contratista_lugares_write on public.mant_contratista_lugares;
create policy mant_contratista_lugares_write on public.mant_contratista_lugares
  for all to authenticated
  using ((select public.mant_puede_editar()))
  with check ((select public.mant_puede_editar()));
