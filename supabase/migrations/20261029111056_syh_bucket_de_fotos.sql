-- ============================================================
-- SdG — Seguridad e Higiene: el bucket de fotos
--
-- REQUIERE QUE 20261029111053_syh_schema.sql YA HAYA CORRIDO: las policies de
-- abajo llaman a tiene_acceso_syh() y puede_editar_syh(), que nacen ahí.
--
-- Calcado de la sección de Storage de 006_mantenimiento_rls.sql, con tres
-- diferencias que son decisiones y no descuidos:
--
--   * BUCKET NUEVO, no se reusa `execution-photos`: ése es de Mantenimiento y
--     tiene sus propias reglas y su propia lista de tipos.
--
--   * PRIVADO (`public = false`), y los links se firman al pedirlos. En
--     Mantenimiento tenía que ser público porque el link se escribe en una
--     planilla que mira gente sin sesión; este módulo no tiene planilla, y no
--     hay nadie sin sesión que deba ver una foto de una condición insegura.
--
--   * LA LISTA DE TIPOS TIENE QUE DECIR LO MISMO QUE `TIPOS` DE LA RUTA DE
--     FOTOS (app/api/seguridad-higiene/fotos/route.ts, Tarea 3 del plan).
--     `image/heif` NO va. Cuando la ruta de Mantenimiento lo aceptaba y el
--     bucket no, una foto HEIF pasaba el chequeo de la ruta y la rechazaba
--     Storage con un 502 que no explicaba nada. Si se suma un tipo, va en los
--     dos lados.
--
-- LAS POLICIES LLAMAN A SU FUNCIÓN ENVUELTA, igual que las de las tablas
-- (`(select tiene_acceso_syh())`): evaluada pelada se repite por fila de
-- storage.objects y no avisa.
--
-- Las rutas dentro del bucket son `condiciones/<id>/<timestamp>.<ext>`. Las
-- policies no miran la carpeta: el permiso es del módulo entero y no de quien
-- subió la foto (un equipo de dos o tres personas mirando la misma lista).
--
-- Diseño: docs/superpowers/specs/2026-10-29-seguridad-e-higiene-design.md
-- Plan:   docs/superpowers/plans/2026-10-29-seguridad-e-higiene.md (Tarea 2)
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'syh-fotos',
  'syh-fotos',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

drop policy if exists syh_fotos_storage_insert on storage.objects;
create policy syh_fotos_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'syh-fotos' and (select puede_editar_syh()));

drop policy if exists syh_fotos_storage_select on storage.objects;
create policy syh_fotos_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'syh-fotos' and (select tiene_acceso_syh()));

drop policy if exists syh_fotos_storage_delete on storage.objects;
create policy syh_fotos_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'syh-fotos' and (select puede_editar_syh()));
