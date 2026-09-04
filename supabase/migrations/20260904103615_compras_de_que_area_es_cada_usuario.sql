-- ============================================================
-- SdG — De qué área de Compras es cada usuario
--
-- POR QUÉ. "Mis pedidos" filtraba por `solicitante_id`, y esa columna está en
-- **null en los 1.947 requerimientos**: los 1.947 vinieron de la planilla y
-- ninguno se cargó desde el sistema, así que la pantalla estaba vacía para
-- todo el mundo.
--
-- Pero el problema de fondo no era ese. Acá **los pedidos se hacen por área, no
-- por persona**: Rocco y Francisco tienen que ver los 950 RI que pidió
-- Mantenimiento, los haya cargado quien los haya cargado. El área sí está
-- cargada en las 1.947 filas, así que con esto la pantalla sirve desde el
-- primer día en vez de esperar a que alguien empiece a pedir desde la app.
--
-- POR QUÉ UNA TABLA Y NO UNA COLUMNA. Una persona puede cubrir más de un área
-- —Mantenimiento y Taller Vial son 950 y 254 RI, y las mira la misma gente— y
-- una columna obligaría a elegir una y perder la otra en silencio.
--
-- NO ES UN PERMISO. Nadie ve ni deja de ver nada por esto: la 018 ya dejó
-- `compras_requerimientos` con lectura abierta a todo usuario autenticado
-- —"el circuito de compras es transversal a toda la empresa"— y la pantalla
-- tiene un botón para ver todos. Esto sólo decide qué se muestra primero.
-- Por eso la lectura es abierta: para saber de qué área es alguien no hace
-- falta ser nadie, y el día que un RI avise por mail a su área, quien manda el
-- mail va a necesitar leer esto.
-- ============================================================

create table if not exists usuario_areas_compras (
  usuario_id uuid not null references usuarios(id) on delete cascade,
  area_id    uuid not null references compras_areas(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (usuario_id, area_id)
);

-- Por área: "quiénes son de Mantenimiento" es la pregunta del día que esto se
-- use para avisar. Por usuario ya lo resuelve la clave primaria.
create index if not exists usuario_areas_compras_area_idx
  on usuario_areas_compras (area_id);

comment on table usuario_areas_compras is
  'De qué áreas de Compras es cada usuario. Decide qué requerimientos ve primero en Mis pedidos; no es un permiso — la lectura de compras_requerimientos es abierta desde la 018.';

alter table usuario_areas_compras enable row level security;

drop policy if exists usuario_areas_compras_select on usuario_areas_compras;
create policy usuario_areas_compras_select on usuario_areas_compras
  for select to authenticated using (true);

-- Escribe sólo el administrador del sistema, en la misma pantalla donde ya
-- carga los permisos de módulo. Que cada uno se ponga su área es tentador y es
-- peor: el área de una persona no es una preferencia suya.
drop policy if exists usuario_areas_compras_write on usuario_areas_compras;
create policy usuario_areas_compras_write on usuario_areas_compras
  for all to authenticated
  using (es_admin())
  with check (es_admin());

notify pgrst, 'reload schema';
