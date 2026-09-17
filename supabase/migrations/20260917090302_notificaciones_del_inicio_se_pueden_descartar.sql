-- ============================================================
-- SdG — Notificaciones del inicio se pueden descartar
--
-- La campanita del Inicio (`components/NotificationsBell.tsx`) no lee una
-- tabla de notificaciones: `GET /api/home/resumen` arma el array en memoria en
-- cada request, contando filas reales (OTs atrasadas, facturas sin vincular,
-- etc. — ver el comentario "Notificaciones reales" en esa ruta). Por eso el
-- globo se queda todo el día con el mismo número: no hay ningún lugar donde
-- guardar que un usuario ya la vio.
--
-- Esta tabla guarda, por usuario y por notificación (`rrhh-sin-clasificar`,
-- `mant-atrasadas`, etc. — el `id` fijo que ya arma esa ruta), la cantidad que
-- tenía cuando el usuario la descartó. La ruta la vuelve a mostrar sólo si la
-- cantidad actual superó a la descartada: si sigue igual o bajó, el problema
-- que la generó no creció y no amerita volver a interrumpir; si subió, hay
-- casos nuevos y sí amerita.
--
-- Es de descarte por usuario, no de borrado del dato: nadie puede "borrar" un
-- requerimiento atrasado, sólo dejar de verlo en el globo hasta que empeore.
-- ============================================================

create table if not exists notificaciones_descartes (
  usuario_id      uuid not null references usuarios(id) on delete cascade,
  notificacion_id text not null,
  cantidad_vista  integer not null default 0,
  descartado_en   timestamptz not null default now(),
  primary key (usuario_id, notificacion_id)
);

alter table notificaciones_descartes enable row level security;

drop policy if exists notificaciones_descartes_select on notificaciones_descartes;
create policy notificaciones_descartes_select on notificaciones_descartes
  for select to authenticated
  using (usuario_id = auth.uid());

drop policy if exists notificaciones_descartes_insert on notificaciones_descartes;
create policy notificaciones_descartes_insert on notificaciones_descartes
  for insert to authenticated
  with check (usuario_id = auth.uid());

drop policy if exists notificaciones_descartes_update on notificaciones_descartes;
create policy notificaciones_descartes_update on notificaciones_descartes
  for update to authenticated
  using (usuario_id = auth.uid())
  with check (usuario_id = auth.uid());

drop policy if exists notificaciones_descartes_delete on notificaciones_descartes;
create policy notificaciones_descartes_delete on notificaciones_descartes
  for delete to authenticated
  using (usuario_id = auth.uid());

notify pgrst, 'reload schema';
