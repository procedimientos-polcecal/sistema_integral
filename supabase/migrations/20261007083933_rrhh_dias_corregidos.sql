-- ============================================================
-- SdG — Los días que tocó una persona
--
-- Spec: docs/superpowers/specs/2026-10-07-rrhh-marcaciones-desde-lenox-design.md
--
-- POR QUÉ: las marcaciones pasan a entrar solas desde la API de Lenox, con un
-- cron diario. Eso convierte en peligroso algo que hoy es inofensivo: editar
-- una fichada NO cambia su `origen`, y el import borra todas las IMPORTADO del
-- día antes de insertar. Hoy casi no muerde porque quien sube el Excel sabe
-- que está pisando un período; un cron pisa sin que nadie se entere.
--
-- POR QUÉ POR DÍA Y NO POR FICHADA. La primera idea fue un tercer valor
-- CORREGIDO en `origen_fichada`. No alcanza, por dos razones:
--   1. La sincronización no reemplaza fichadas, reemplaza DÍAS. Proteger la
--      fila corregida y reinsertar el día deja las dos: el día duplicado.
--   2. Borrar no deja rastro. Una marca fantasma a 40 minutos de la anterior
--      (el filtro sólo descarta las de ≤5 min) arma un turno falso; alguien lo
--      borra; mañana el cron lo vuelve a crear. Todos los días, para siempre.
--      Con el enum no se arregla: la fila que lo probaría ya no existe.
-- ============================================================

create table if not exists rrhh_dias_corregidos (
  id          uuid primary key default gen_random_uuid(),
  empleado_id uuid not null references empleados(id) on delete cascade,
  fecha       date not null,
  -- El ÚLTIMO que lo tocó (ver los comment on column de abajo). No es
  -- decorativo: cuando alguien pregunte "¿por qué este día no se actualiza?",
  -- la respuesta tiene que estar escrita.
  usuario_id  uuid not null references usuarios(id),
  accion      text not null check (accion in ('creada', 'editada', 'borrada')),
  created_at  timestamptz not null default now(),
  unique (empleado_id, fecha)
);

-- La sincronización trae el rango de fechas y después filtra los empleados en
-- memoria. Ese rango por fecha es lo que el índice implícito del unique (que
-- empieza por empleado_id) no puede resolver; por eso los dos índices no son
-- redundantes: el unique sirve para el upsert y para buscar un empleado, éste
-- para recorrer un período entero.
create index if not exists rrhh_dias_corregidos_fecha_idx
  on rrhh_dias_corregidos (fecha, empleado_id);

alter table rrhh_dias_corregidos enable row level security;

drop policy if exists rrhh_dias_corregidos_select on rrhh_dias_corregidos;
create policy rrhh_dias_corregidos_select on rrhh_dias_corregidos
  for select to authenticated using (tiene_acceso_rrhh());

drop policy if exists rrhh_dias_corregidos_write on rrhh_dias_corregidos;
create policy rrhh_dias_corregidos_write on rrhh_dias_corregidos
  for all to authenticated using (puede_editar_rrhh()) with check (puede_editar_rrhh());

comment on table rrhh_dias_corregidos is
  'Los (empleado, día) que tocó una persona a mano. La sincronización con '
  'Lenox los saltea y avisa si lo que trae el reloj difiere de lo guardado.';

-- Las rutas escriben con upsert sobre (empleado_id, fecha): al segundo toque del
-- mismo día, usuario_id y accion pasan a ser los del último toque, y created_at
-- se queda en el del primero. Se deja dicho acá porque lo que se le contesta a
-- quien pregunta "¿quién tocó este día?" depende de leer bien cuál es cuál.
comment on column rrhh_dias_corregidos.usuario_id is
  'Quién lo tocó POR ÚLTIMA VEZ. Si varias personas corrigieron el mismo día, '
  'las anteriores no quedan registradas acá.';
comment on column rrhh_dias_corregidos.accion is
  'Qué hizo el último toque (creada, editada o borrada), no el primero. Un día '
  'creado y después editado figura como editada.';
comment on column rrhh_dias_corregidos.created_at is
  'Cuándo se corrigió el día por PRIMERA vez. No se actualiza con los toques '
  'siguientes: es desde cuándo la sincronización lo viene salteando.';
