-- ============================================================
-- SdG — Auditoría de lo irreversible
--
-- Spec: docs/superpowers/specs/2026-09-22-auditoria-de-lo-irreversible-design.md
--
-- POR QUÉ, EN UNA LÍNEA: **postear un asiento en Odoo —la única acción del
-- sistema que no se deshace— no registra quién la ejecutó.** La ruta comprueba
-- el permiso, exige `confirmar: true` para que no salga de un clic accidental,
-- y después llama a `confirmarElBorrador(createAdminClient(), id)`: el id del
-- usuario no se persiste en ningún lado. Tampoco deja rastro conceder un módulo
-- a un usuario ni cerrar una liquidación.
--
-- EL ALCANCE NO ES "AUDITAR TODO". El capítulo 28 de la Documentación Funcional
-- pide auditar todo cambio de todo campo; acá se arranca por las cinco acciones
-- que no se pueden deshacer, que es donde hoy "¿quién hizo esto?" no tiene
-- respuesta. Ampliar después es una llamada más, no una tabla distinta.
--
-- ── POR QUÉ LA ESCRIBE LA APLICACIÓN Y NO UN TRIGGER ────────
--
-- Es lo contrario de lo que hizo Compras, y la razón está medida. De las 2.922
-- filas de `compras_historial`, **2.852 no tienen `usuario_id`** (97,6%) y
-- **una sola tiene nota**: las escribe el trigger `compras_requerimientos_log_estado`,
-- que se dispara en el update y no tiene de dónde sacar el autor.
--
-- Y eso no se arregla con `auth.uid()` adentro del trigger: **60 de las 125
-- rutas que escriben usan `createAdminClient()`**, que va con la service role y
-- no lleva JWT, así que ahí `auth.uid()` es null siempre. Ya está anotado en
-- `app/api/inventario/movimientos/route.ts`, donde costó un rato entenderlo.
--
-- **El trigger de Compras no se saca.** Cubre lo que la app no ve —la
-- sincronización de la planilla y un `update` a mano en el editor SQL— y
-- sacarlo sería perder eso para ganar prolijidad. Conviven: el trigger dice
-- *qué* cambió siempre, esta tabla agrega *quién* y *por qué* cuando hubo
-- alguien.
-- ============================================================

-- == 1. La tabla ==============================================

create table if not exists auditoria (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),

  -- Quién. Va `on delete set null` y no `cascade`: borrar un usuario no puede
  -- borrarle las acciones. El nombre queda cacheado al lado justamente para
  -- eso — el capítulo 28 lo pide como "ex usuario X".
  usuario_id      uuid references usuarios(id) on delete set null,
  usuario_nombre  text,

  -- Lo que hoy falta para distinguir "no sé quién" de "lo movió la planilla".
  -- Sin esto se repite el agujero de las 2.852 filas sin autor: un null que no
  -- se sabe si es un olvido o un proceso automático.
  actor           text not null default 'persona'
                  check (actor in ('persona', 'sincronizacion', 'cron')),

  -- Sobre qué. `modulo` es **text y no el enum `modulo`** a propósito: tiene
  -- que poder decir `administracion`, que no es un módulo del sistema sino la
  -- pantalla que reparte permisos. Agregarlo al enum costaría su propio archivo
  -- de migración —un valor de enum nuevo viaja solo, trampa #1 del README— para
  -- ganar nada: acá nadie hace joins contra el enum.
  modulo          text not null,
  entidad         text not null,
  entidad_id      text not null,

  accion          text not null
                  check (accion in ('postear', 'aprobar', 'denegar', 'cerrar',
                                    'ajustar', 'conceder_acceso', 'quitar_acceso')),

  valor_anterior  text,
  valor_nuevo     text,

  -- Obligatorio en `denegar` y en `ajustar`, pero **lo valida la aplicación**
  -- (`lib/core/auditoria.ts`) y no un check de acá. El motivo: el error tiene
  -- que poder decir *cuál* falta y en castellano, y un `23514` de Postgres
  -- llega a la pantalla como "new row violates check constraint".
  motivo          text,

  -- El `odoo_move_id` del asiento, el importe, el número de RI.
  contexto        jsonb
);

-- Las dos consultas que se van a hacer: "qué pasó con esta factura" y "qué
-- pasó el martes".
create index if not exists auditoria_entidad_idx on auditoria (entidad, entidad_id, created_at desc);
create index if not exists auditoria_fecha_idx   on auditoria (created_at desc);
create index if not exists auditoria_usuario_idx on auditoria (usuario_id, created_at desc);

comment on table auditoria is
  'Quién hizo cada acción que no se deshace. La escribe la aplicación (lib/core/auditoria.ts), no un trigger: ver el encabezado de la migración 20261005090646.';

-- == 2. Inmutable de verdad, no por convención ================
--
-- El capítulo 28 pide que no se pueda modificar ni borrar "ni siquiera por el
-- Administrador". Acá eso son dos cosas, porque una sola no alcanza.

alter table auditoria enable row level security;

-- Escribir: cualquier autenticado. No es laxitud — es que la fila la escribe la
-- ruta en nombre de quien hizo la acción, y quien puede hacer la acción ya pasó
-- el permiso del módulo unas líneas antes.
drop policy if exists auditoria_insert on auditoria;
create policy auditoria_insert on auditoria
  for insert to authenticated with check (true);

-- Leer: sólo `admin_sistema`, la misma llave que `/administracion`.
-- Arranca cerrado porque es lo reversible: abrirlo después a los admin de cada
-- módulo es una policy; cerrarlo después de que alguien lo vio, no.
drop policy if exists auditoria_select on auditoria;
create policy auditoria_select on auditoria
  for select to authenticated using (es_admin_sistema());

-- **No hay policy de update ni de delete, y es deliberado**: sin policy, RLS
-- niega. Pero eso sólo frena a la sesión de una persona; la service role
-- saltea RLS entera, y en este repo 60 rutas escriben con ella. Por eso además
-- va el trigger de abajo, que es lo único que sí frena al cliente admin.
create or replace function public.auditoria_es_inmutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'La auditoría no se modifica ni se borra (intento de % sobre auditoria)', tg_op;
end;
$$;

-- `create trigger` no acepta `if not exists`, así que primero se borra: esta
-- migración se va a correr dos veces (trampa #4 del README).
drop trigger if exists auditoria_sin_update_ni_delete on auditoria;
create trigger auditoria_sin_update_ni_delete
  before update or delete on auditoria
  for each row execute function public.auditoria_es_inmutable();

-- Para comprobarlo a ojo después de correrla, con la service role, que es el
-- caso que importa. Las dos tienen que fallar:
--
--   update auditoria set motivo = 'cambiado' where id = (select id from auditoria limit 1);
--   delete from auditoria where id = (select id from auditoria limit 1);
